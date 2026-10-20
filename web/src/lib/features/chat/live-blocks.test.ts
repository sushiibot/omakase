/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { ChatEnvelope, LiveBlock, LiveBlockOp } from '$lib/core/realtime/events';
import type { Hub } from '$lib/core/realtime/hub.svelte';
import { LiveBlocks, type LiveBlocksApi } from './live-blocks.svelte';
import { applyLiveOps, liveBlocks, newLiveBlock } from './render/rich/live';

const KEY = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const block = newLiveBlock(
	liveBlocks('```checklist\nitems: [milk, eggs]\n```')[0],
	KEY,
	'main',
	new Date('2026-10-20T12:00:00Z')
);

function fakeHub() {
	let deliver: ((batch: readonly ChatEnvelope[]) => void) | null = null;
	const hub = {
		subscribe: (_: unknown, fn: (batch: readonly ChatEnvelope[]) => void) => {
			deliver = fn;
			return () => {};
		},
		start: () => {}
	} as unknown as Hub;
	return { hub, emit: (ev: ChatEnvelope) => deliver?.([ev]) };
}

function fakeApi(opts: { fail?: boolean } = {}) {
	const lists: string[][] = [];
	const applied: { id: string; ops: readonly LiveBlockOp[] }[] = [];
	let server = block;
	let release: () => void = () => {};
	const api: LiveBlocksApi = {
		list: async (keys) => {
			lists.push([...keys]);
			return { blocks: keys.includes(KEY) ? [server] : [] };
		},
		apply: (id, ops) => {
			applied.push({ id, ops });
			return new Promise((resolve, reject) => {
				release = () => {
					if (opts.fail) return reject(new Error('refused'));
					const r = applyLiveOps(server, ops, 'owner', new Date());
					if (r.ok) server = r.block;
					resolve({ blocks: [server] });
				};
			});
		}
	};
	return { api, lists, applied, release: () => release() };
}

const settle = () => new Promise((r) => setTimeout(r, 40));

describe('live blocks store', () => {
	test('loads each reply once, in a batch', async () => {
		const { api, lists } = fakeApi();
		const store = new LiveBlocks(api, fakeHub().hub);
		store.watch([KEY, 'not a key!', KEY]);
		store.watch([KEY]);
		await settle();
		expect(lists).toEqual([[KEY]]);
		expect(store.get(KEY, 0)?.revision).toBe(1);
	});

	test('a change shows at once and the server answer replaces it', async () => {
		const { api, applied, release } = fakeApi();
		const store = new LiveBlocks(api, fakeHub().hub);
		store.watch([KEY]);
		await settle();
		store.apply(block.id, [{ op: 'check', item: 0, done: true }]);
		expect(store.get(KEY, 0)?.state.items?.[0].done).toBe(true);
		expect(applied).toHaveLength(1);
		release();
		await settle();
		expect(store.get(KEY, 0)).toMatchObject({ revision: 2, updatedBy: 'owner' });
	});

	test('a refused change shows the stored state again', async () => {
		const { api, release } = fakeApi({ fail: true });
		const store = new LiveBlocks(api, fakeHub().hub);
		store.watch([KEY]);
		await settle();
		store.apply(block.id, [{ op: 'check', item: 1, done: true }]);
		release();
		await settle();
		expect(store.get(KEY, 0)?.state.items?.[1].done).toBe(false);
	});

	test('changes from elsewhere arrive as events; an older revision never wins', async () => {
		const { api } = fakeApi();
		const { hub, emit } = fakeHub();
		const store = new LiveBlocks(api, hub);
		store.start();
		const newer = applyLiveOps(block, [{ op: 'add', text: 'rice' }], 'agent', new Date());
		if (!newer.ok) throw new Error(newer.error);
		emit({ type: 'block', data: { block: newer.block } } as ChatEnvelope);
		emit({ type: 'block', data: { block } } as ChatEnvelope);
		expect(store.get(KEY, 0)?.state.items?.map((i) => i.text)).toEqual(['milk', 'eggs', 'rice']);
	});

	test('a reconnect reloads the replies on screen', async () => {
		const { api, lists } = fakeApi();
		const { hub, emit } = fakeHub();
		const store = new LiveBlocks(api, hub);
		store.start();
		store.watch([KEY]);
		await settle();
		emit({ type: 'hello', data: {} } as ChatEnvelope);
		await settle();
		expect(lists).toEqual([[KEY], [KEY]]);
	});
});
