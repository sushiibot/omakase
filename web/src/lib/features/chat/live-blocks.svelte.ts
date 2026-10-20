import { SvelteMap } from 'svelte/reactivity';
import { featureHttp } from '$lib/core/feature-http';
import type { ChatEnvelope, LiveBlock, LiveBlockOp } from '$lib/core/realtime/events';
import { hub as appHub, type Hub } from '$lib/core/realtime/hub.svelte';
import { applyLiveOps, isMessageKey, liveBlockId, type LiveBlockAccess } from './render/rich/live';

// Live blocks (checklists, recipes, timers, reply blocks) as stored in the workspace. Replies on
// screen ask for their blocks by reply key; changes apply here at once (the same live.ts logic as
// the workspace) and are confirmed by the server, and every change made elsewhere, by the agent or
// another device, arrives as a `block` event.

export interface LiveBlocksApi {
	list(keys: readonly string[]): Promise<{ blocks: LiveBlock[] }>;
	apply(id: string, ops: readonly LiveBlockOp[]): Promise<{ blocks: LiveBlock[] }>;
}

const http = featureHttp("Live blocks aren't available yet.");
export const httpLiveBlocksApi: LiveBlocksApi = {
	list: (keys) => http.get(`/blocks?keys=${keys.map(encodeURIComponent).join(',')}`),
	apply: (id, ops) => http.post('/blocks', { id, ops })
};

const BATCH = 50;

export class LiveBlocks implements LiveBlockAccess {
	readonly records = new SvelteMap<string, LiveBlock>();
	#requested = new Set<string>();
	#queue = new Set<string>();
	#timer: ReturnType<typeof setTimeout> | null = null;
	#stop: (() => void) | null = null;

	constructor(
		private readonly api: LiveBlocksApi = httpLiveBlocksApi,
		private readonly hub: Hub = appHub
	) {}

	start() {
		if (this.#stop) return;
		this.#stop = this.hub.subscribe({ types: ['block'] }, (batch) => {
			for (const ev of batch) this.#onEvent(ev);
		});
		this.hub.start();
	}

	#onEvent(ev: ChatEnvelope) {
		if (ev.type === 'block') this.#accept(ev.data.block);
		// After a reconnect, changes made while away were not replayed: reload what is on screen.
		else if (ev.type === 'hello' && this.#requested.size) {
			for (const key of this.#requested) this.#queue.add(key);
			this.#schedule();
		}
	}

	/** Keeps the newest revision; an older answer never overwrites a newer event. */
	#accept(block: LiveBlock) {
		const current = this.records.get(block.id);
		if (!current || block.revision >= current.revision) this.records.set(block.id, block);
	}

	watch(keys: readonly string[]) {
		for (const key of keys) {
			if (!isMessageKey(key) || this.#requested.has(key)) continue;
			this.#requested.add(key);
			this.#queue.add(key);
		}
		if (this.#queue.size) this.#schedule();
	}

	#schedule() {
		if (this.#timer) return;
		this.#timer = setTimeout(() => {
			this.#timer = null;
			const keys = [...this.#queue];
			this.#queue.clear();
			for (let i = 0; i < keys.length; i += BATCH) void this.#load(keys.slice(i, i + BATCH));
		}, 30);
	}

	async #load(keys: string[]) {
		try {
			const { blocks } = await this.api.list(keys);
			for (const block of blocks) this.#accept(block);
		} catch {
			// Offline or an older workspace: the blocks keep working on this device alone; try again later.
			for (const key of keys) this.#requested.delete(key);
		}
	}

	get(messageKey: string, index: number): LiveBlock | undefined {
		return this.records.get(liveBlockId(messageKey, index));
	}

	apply(id: string, ops: readonly LiveBlockOp[]) {
		const before = this.records.get(id);
		if (!before) return;
		const local = applyLiveOps(before, ops, 'owner', new Date());
		if (!local.ok) return;
		this.records.set(id, local.block);
		void this.api.apply(id, ops).then(
			({ blocks }) => {
				for (const block of blocks) this.records.set(block.id, block);
			},
			() => {
				// Refused or offline: show the stored state again.
				if (this.records.get(id) === local.block) this.records.set(id, before);
				this.#requested.delete(before.messageKey);
				this.watch([before.messageKey]);
			}
		);
	}
}

let store: LiveBlocks | null = null;

/** The app-wide store; block events arrive on the main stream for every conversation. */
export function liveBlocksStore(): LiveBlocks {
	if (!store) {
		store = new LiveBlocks();
		store.start();
	}
	return store;
}
