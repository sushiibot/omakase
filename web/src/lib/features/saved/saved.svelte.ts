import { SvelteSet } from 'svelte/reactivity';
import type { LiveBlock } from '$lib/core/realtime/events';
import { hub as appHub, type Hub } from '$lib/core/realtime/hub.svelte';
import { Remote } from '$lib/core/remote.svelte';
import { liveBlocksStore, type SavedAccess } from '$lib/features/chat';
import { httpSavedApi, type SavedApi } from './api';
import { savedHref } from './model';
import type { SavedAction, SavedItem, SavedList } from './types';

// Every saved item (documents, checklists, recipes, timers), loaded once and kept fresh: a `block`
// event (a list ticked, a timer started) or a `saved` event (pinned, archived, a document saved,
// a new block delivered) refetches the list shortly after, and so does reconnecting. Library,
// side panel and Home all read this one list. Pin and archive apply here at once and are
// confirmed by the server.

const REFETCH_MS = 300;

let configured: SavedApi = httpSavedApi;

export class SavedStore implements SavedAccess {
	readonly all: Remote<SavedList>;
	/** Ids with a change in flight. */
	readonly busy = new SvelteSet<string>();
	error = $state<string | null>(null);
	#stop: (() => void) | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		readonly api: SavedApi = configured,
		private readonly hub: Hub = appHub
	) {
		this.all = new Remote(() => this.api.list({ status: 'all' }), { refetchOnFocus: true });
	}

	start() {
		if (this.#stop) return;
		this.#stop = this.hub.subscribe({ types: ['block', 'saved'] }, (batch) => {
			if (batch.some((ev) => ev.type === 'block' || ev.type === 'saved' || ev.type === 'hello'))
				this.#schedule();
		});
		this.hub.start();
	}

	stop() {
		this.#stop?.();
		this.#stop = null;
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = null;
	}

	#schedule() {
		if (this.all.status === 'idle' || this.#timer) return;
		this.#timer = setTimeout(() => {
			this.#timer = null;
			void this.all.refetch();
		}, REFETCH_MS);
	}

	get items(): SavedItem[] {
		return this.all.data?.items ?? [];
	}

	find(id: string): SavedItem | undefined {
		return this.items.find((i) => i.id === id);
	}

	/** Replaces (or adds) one item in the loaded list. */
	put(item: SavedItem) {
		const data = this.all.data;
		if (!data) return;
		const known = data.items.some((i) => i.id === item.id);
		this.all.data = {
			...data,
			items: known ? data.items.map((i) => (i.id === item.id ? item : i)) : [item, ...data.items]
		};
	}

	/** Pins, unpins, archives or restores at once, then confirms with the server's answer. A
	 *  refusal shows the stored state again. */
	async act(id: string, action: SavedAction): Promise<SavedItem | null> {
		const before = this.find(id);
		if (before && action !== 'opened') this.put(optimistic(before, action));
		if (action !== 'opened') this.busy.add(id);
		this.error = null;
		try {
			const item = await this.api.act(id, action);
			this.put(item);
			return item;
		} catch (err) {
			if (before) this.put(before);
			if (action !== 'opened')
				this.error = err instanceof Error ? err.message : 'Could not update this item.';
			return null;
		} finally {
			this.busy.delete(id);
		}
	}

	// SavedAccess: what a live block in chat needs.
	pinned(id: string): boolean {
		// A block in chat may be the first to ask: load the list then, outside the render.
		if (this.all.status === 'idle') queueMicrotask(() => void this.all.ensure());
		return !!this.find(id)?.pinned;
	}
	setPinned(id: string, pinned: boolean) {
		void this.act(id, pinned ? 'pin' : 'unpin');
	}
	href(block: LiveBlock): string {
		return savedHref({ kind: block.type as SavedItem['kind'], id: block.id });
	}
}

function optimistic(item: SavedItem, action: SavedAction): SavedItem {
	switch (action) {
		case 'pin':
			return { ...item, pinned: true, archived: false, status: 'active' };
		case 'unpin':
			return { ...item, pinned: false };
		case 'archive':
			return { ...item, pinned: false, archived: true, status: 'done' };
		case 'restore':
			return { ...item, archived: false, status: 'active' };
		default:
			return item;
	}
}

let store: SavedStore | null = null;

/** Uses another API (fixtures in `bun dev ?fake`), before the store is first used. */
export function configureSaved(api: SavedApi) {
	configured = api;
	store?.stop();
	store = null;
}

/** The app-wide store. It also lets live blocks in chat offer Pin and Open. */
export function savedStore(): SavedStore {
	if (!store) {
		store = new SavedStore();
		store.start();
		liveBlocksStore().saved = store;
	}
	return store;
}
