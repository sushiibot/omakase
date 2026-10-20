/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { ChatEnvelope } from '$lib/core/realtime/events';
import type { Hub } from '$lib/core/realtime/hub.svelte';
import type { SavedApi } from './api';
import { savedQuery } from './api';
import { conversationSaved, filterSaved, groupSaved, inUse, stateLine } from './model';
import { SavedStore } from './saved.svelte';
import type { SavedAction, SavedItem } from './types';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const item = (over: Partial<SavedItem>): SavedItem => ({
	kind: 'checklist',
	id: '01JABCDEFGHJKMNPQRSTVWXYZ0.0',
	title: 'List',
	conversationId: 'main',
	sourceMessageId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
	status: 'active',
	pinned: false,
	archived: false,
	createdAt: '2026-10-19T12:00:00Z',
	updatedAt: '2026-10-20T11:00:00Z',
	updatedBy: 'agent',
	summary: '0 of 2 done',
	progress: { done: 0, total: 2 },
	...over
});
const groceries = item({ id: 'g.0', title: 'Groceries', pinned: true });
const tea = item({
	id: 't.0',
	kind: 'timer',
	title: 'Tea',
	progress: undefined,
	endsAt: new Date(NOW + 60_000).toISOString()
});
const packed = item({
	id: 'p.0',
	title: 'Packed',
	conversationId: 'trip',
	progress: { done: 2, total: 2 }
});
const plan = item({
	id: '00000000-0000-4000-8000-000000000001',
	kind: 'document',
	title: 'Plan',
	conversationId: 'trip',
	progress: undefined,
	summary: 'Version 1'
});
const old = item({ id: 'o.0', title: 'Old', status: 'done', conversationId: 'trip' });

describe('saved model', () => {
	test('groups Pinned first, then by conversation in order of use', () => {
		const groups = groupSaved([groceries, plan, tea, packed], (id) => `#${id}`);
		expect(groups.map((g) => [g.label, g.items.map((i) => i.title)])).toEqual([
			['Pinned', ['Groceries']],
			['#trip', ['Plan', 'Packed']],
			['#main', ['Tea']]
		]);
	});

	test('filters by chip and status', () => {
		const all = [groceries, tea, plan, old];
		expect(filterSaved(all, { chip: 'docs' }).map((i) => i.title)).toEqual(['Plan']);
		expect(filterSaved(all, { chip: 'lists', status: 'active' }).map((i) => i.title)).toEqual([
			'Groceries'
		]);
		expect(filterSaved(all, { status: 'done' }).map((i) => i.title)).toEqual(['Old']);
	});

	test('a conversation lists active items first, then done', () => {
		expect(conversationSaved([groceries, plan, old, packed], 'trip')).toEqual({
			active: [plan, packed],
			done: [old]
		});
	});

	test('in use: pinned, then running timers, then open checklists, at most four', () => {
		const open = item({ id: 'x.0', title: 'Open' });
		const stopped = { ...tea, id: 's.0', endsAt: undefined };
		expect(inUse([open, packed, plan, stopped, tea, groceries], NOW).map((i) => i.title)).toEqual([
			'Groceries',
			'Tea',
			'Open'
		]);
		const many = Array.from({ length: 6 }, (_, n) => item({ id: `${n}.0`, title: `L${n}` }));
		expect(inUse(many, NOW)).toHaveLength(4);
	});

	test('a running timer shows its end; a finished one says so', () => {
		expect(stateLine(tea, NOW)).toMatch(/^Running · ends /);
		expect(stateLine(tea, NOW + 120_000)).toBe('Finished');
		expect(stateLine(groceries, NOW)).toBe('0 of 2 done');
	});

	test('list filters become query parameters', () => {
		expect(savedQuery({ status: 'all' })).toBe('?status=all');
		expect(
			savedQuery({ conversationId: 'trip', kind: 'recipe', pinned: false, query: ' pan ' })
		).toBe('?conversation=trip&kind=recipe&pinned=0&q=pan');
	});
});

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
	let items = [groceries, tea, plan];
	const calls: string[] = [];
	const api: SavedApi = {
		list: async () => {
			calls.push('list');
			return { items };
		},
		get: async (id) => items.find((i) => i.id === id) ?? null,
		act: async (id: string, action: SavedAction) => {
			calls.push(`${action}:${id}`);
			await new Promise((r) => setTimeout(r, 10));
			if (opts.fail) throw new Error('refused');
			items = items.map((i) =>
				i.id === id ? { ...i, pinned: action === 'pin', archived: action === 'archive' } : i
			);
			return items.find((i) => i.id === id)!;
		},
		document: async () => null
	};
	return { api, calls };
}

const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('saved store', () => {
	test('loads once and refetches shortly after block, saved and reconnect events', async () => {
		const { api, calls } = fakeApi();
		const { hub, emit } = fakeHub();
		const store = new SavedStore(api, hub);
		store.start();
		emit({ type: 'saved', data: { kind: 'document', id: plan.id } } as ChatEnvelope);
		await settle(350);
		expect(calls).toEqual([]);
		await store.all.ensure();
		expect(store.items.map((i) => i.title)).toEqual(['Groceries', 'Tea', 'Plan']);
		emit({ type: 'block', data: { block: {} } } as unknown as ChatEnvelope);
		emit({ type: 'saved', data: { kind: 'document', id: plan.id } } as ChatEnvelope);
		await settle(350);
		expect(calls).toEqual(['list', 'list']);
		emit({ type: 'hello', data: {} } as unknown as ChatEnvelope);
		await settle(350);
		expect(calls).toEqual(['list', 'list', 'list']);
		store.stop();
	});

	test('pin applies at once and is confirmed by the server', async () => {
		const { api, calls } = fakeApi();
		const store = new SavedStore(api, fakeHub().hub);
		await store.all.ensure();
		const done = store.act(tea.id, 'pin');
		expect(store.pinned(tea.id)).toBe(true);
		expect(store.busy.has(tea.id)).toBe(true);
		expect(await done).toMatchObject({ pinned: true });
		expect(store.busy.has(tea.id)).toBe(false);
		expect(calls).toContain(`pin:${tea.id}`);
		store.setPinned(groceries.id, false);
		await settle(30);
		expect(store.pinned(groceries.id)).toBe(false);
	});

	test('a refused change shows the stored state again, with the reason', async () => {
		const { api } = fakeApi({ fail: true });
		const store = new SavedStore(api, fakeHub().hub);
		await store.all.ensure();
		const done = store.act(tea.id, 'archive');
		expect(store.find(tea.id)).toMatchObject({ archived: true, status: 'done' });
		expect(await done).toBeNull();
		expect(store.find(tea.id)).toMatchObject({ archived: false, status: 'active' });
		expect(store.error).toBe('refused');
	});

	test('a block links to its item page', () => {
		const store = new SavedStore(fakeApi().api, fakeHub().hub);
		expect(store.href({ type: 'recipe', id: 'K.1' } as never)).toBe('/saved/recipe/K~1');
	});
});
