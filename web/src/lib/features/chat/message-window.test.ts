/// <reference types="bun" />
import { afterAll, expect, test } from 'bun:test';
import type { ChatEnvelope, WebHistoryItem } from '$lib/core/realtime/events';
import { createHub } from '$lib/core/realtime/hub.svelte';
import type { ChatTransport } from '$lib/core/realtime/transport';
import type { KeyValue } from '$lib/core/storage/outbox';
import type { ChatApi } from './api';
import { linkTarget } from './links';
import { toMessages } from './project';
import {
	appendHistory,
	applyEvent,
	createState,
	joinWindow,
	mergeHistory,
	messageKey
} from './reduce';
import { ChatStore } from './store.svelte';

const g = globalThis as unknown as { document?: unknown };
const stubbedDocument = g.document === undefined;
if (stubbedDocument)
	g.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
afterAll(() => {
	if (stubbedDocument) delete g.document;
});

const reply = (seq: number, extra: Partial<Extract<WebHistoryItem, { type: 'assistant' }>> = {}) =>
	({
		type: 'assistant',
		id: String(seq),
		at: new Date(Date.UTC(2026, 9, 1, 12, seq)).toISOString(),
		text: `reply ${seq}`,
		outboxId: `outbox-${seq}`,
		tools: [],
		files: [],
		...extra
	}) satisfies WebHistoryItem;

const texts = (items: { parts: { type: string }[] }[]) =>
	items.flatMap((m) => m.parts.flatMap((p) => ('text' in p ? [p.text as string] : [])));

test('every stored row has a stable key: its own key, else s<seq>', () => {
	const s = createState();
	mergeHistory(s, [
		{
			type: 'user',
			id: '1',
			clientId: '01J9Z3W8K2M4N6P8Q0R2S4T6V8',
			at: 'x',
			text: 'mine',
			attachments: []
		},
		{ type: 'user', id: '-4', at: 'x', text: 'imported', attachments: [] },
		reply(2),
		{ type: 'assistant', id: '3', at: 'x', text: 'no key', tools: [], files: [] },
		{
			type: 'ask',
			id: '5',
			at: 'x',
			outboxId: 'ask-outbox',
			askId: 'pick-one',
			question: 'q',
			choices: []
		},
		{ type: 'divider', id: '6', at: 'x', kind: 'new' },
		{
			type: 'alert',
			id: '7',
			at: 'x',
			outboxId: 'alert-outbox',
			alert: { job: 'j', kind: 'failed' } as never,
			text: ''
		}
	]);
	expect(s.items.map(messageKey)).toEqual([
		'01J9Z3W8K2M4N6P8Q0R2S4T6V8',
		's-4',
		'outbox-2',
		's3',
		'pick-one',
		's6',
		'alert-outbox'
	]);
	// Live rows key the same way as their stored copies; a live boundary by its seq.
	applyEvent(s, { type: 'session', seq: 9, data: { kind: 'compacted' } });
	applyEvent(s, { type: 'reply', seq: 10, data: { key: 'live-reply-1', text: 'live', files: [] } });
	expect(s.items.slice(-2).map(messageKey)).toEqual(['s9', 'live-reply-1']);
	expect(toMessages(s.items).at(-1)?.key).toBe('live-reply-1');
});

test('a window pages newer, then joins the live chat without repeating or losing anything', () => {
	const live = createState();
	mergeHistory(live, [reply(8), reply(9), reply(10)]);
	// A reply that arrived live after the newest page.
	applyEvent(live, {
		type: 'reply',
		seq: 11,
		data: { key: 'outbox-11', text: 'reply 11', files: [] }
	});
	const w = createState();
	mergeHistory(w, [reply(3), reply(4), reply(5)]);
	appendHistory(w, [reply(6), reply(7), reply(8)]);
	appendHistory(w, [reply(8), reply(9), reply(10)]);
	expect(texts(toMessages(w.items))).toEqual([3, 4, 5, 6, 7, 8, 9, 10].map((n) => `reply ${n}`));
	expect(joinWindow(live, w)).toBe(5);
	expect(texts(toMessages(live.items))).toEqual(
		[3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => `reply ${n}`)
	);
	// The joined rows dedupe later copies, as any history row does.
	applyEvent(live, { type: 'reply', seq: 12, data: { key: 'outbox-4', text: 'again', files: [] } });
	expect(live.items).toHaveLength(9);
});

test('a window inside what live already holds adds nothing', () => {
	const live = createState();
	mergeHistory(live, [reply(1), reply(2), reply(3), reply(4)]);
	const w = createState();
	mergeHistory(w, [reply(2), reply(3), reply(4)]);
	expect(joinWindow(live, w)).toBe(0);
	expect(live.items).toHaveLength(4);
});

test('link params: m wins, then the older turn, ask and approve', () => {
	expect(linkTarget(new URLSearchParams('m=abcdefgh&turn=t'))).toEqual({ message: 'abcdefgh' });
	expect(linkTarget(new URLSearchParams('turn=t&ask=a'))).toEqual({ turn: 't' });
	expect(linkTarget(new URLSearchParams('approve=n'))).toEqual({ approve: 'n' });
	expect(linkTarget(new URLSearchParams('view=conversation'))).toBeNull();
});

// ── The store ──

function memory<T>(): KeyValue<T> {
	return { all: async () => [], put: async () => {}, delete: async () => {} };
}

/** A conversation of `n` replies, served the way the gateway pages it, with indexes as cursors. */
function server(n: number, opts: { live?: ChatEnvelope[]; failAround?: number } = {}) {
	let failAround = opts.failAround ?? 0;
	const all: WebHistoryItem[] = Array.from({ length: n }, (_, i) => reply(i + 1));
	const calls: string[] = [];
	let push: (ev: ChatEnvelope) => void = () => {};
	const transport: ChatTransport = {
		connect(_after, on, onState) {
			push = on;
			setTimeout(() => {
				onState('open');
				on({
					type: 'hello',
					data: {
						headSeq: n,
						workspace: 'online',
						openTurns: [],
						pending: { approvals: [], asks: [] }
					}
				});
				for (const ev of opts.live ?? []) on(ev);
			}, 0);
			return () => {};
		}
	};
	const api = {
		async history({ before, after, around, limit }) {
			calls.push(
				around
					? `around:${around}`
					: after
						? `after:${after}`
						: before
							? `before:${before}`
							: 'newest'
			);
			if (around && failAround-- > 0) return { ok: false };
			if (around) {
				const at = all.findIndex(
					(h) => `s${h.id}` === around || (h.type === 'assistant' && h.outboxId === around)
				);
				const side = Math.floor(limit / 2);
				const pivot = /^s(\d+)$/.exec(around);
				if (at < 0 && !pivot)
					return {
						ok: true,
						page: {
							items: all.slice(-limit),
							before: all.length > limit ? String(all.length - limit) : null,
							after: null,
							target: null,
							missing: true
						}
					};
				const centre = at < 0 ? all.findIndex((h) => Number(h.id) > Number(pivot![1])) : at;
				const start = Math.max(0, centre - side);
				const end = Math.min(all.length, centre + side + (at < 0 ? 0 : 1));
				return {
					ok: true,
					page: {
						items: all.slice(start, end),
						before: start > 0 ? String(start) : null,
						after: end < all.length ? String(end) : null,
						target: at < 0 ? null : all[at].id,
						...(at < 0 ? { missing: true } : {})
					}
				};
			}
			if (after) {
				const start = Number(after);
				const end = Math.min(all.length, start + limit);
				return {
					ok: true,
					page: {
						items: all.slice(start, end),
						before: String(start),
						after: end < all.length ? String(end) : null
					}
				};
			}
			const end = before ? Number(before) : all.length;
			const start = Math.max(0, end - limit);
			return {
				ok: true,
				page: { items: all.slice(start, end), before: start > 0 ? String(start) : null }
			};
		},
		seen: async () => {}
	} as Partial<ChatApi> as ChatApi;
	const store = new ChatStore('main', {
		hub: createHub({ transport }),
		api,
		outbox: memory(),
		drafts: memory()
	});
	return {
		store,
		calls,
		all,
		push: (ev: ChatEnvelope) => push(ev),
		/** A reply stored after the store loaded, as the stream delivers it. */
		add(seq: number) {
			all.push(reply(seq));
			push({ type: 'reply', seq, data: { key: `outbox-${seq}`, text: `reply ${seq}`, files: [] } });
		}
	};
}

const shown = (store: ChatStore) => texts(store.messages);

test('a link to an old message opens a detached window around it; live replies wait in the live chat', async () => {
	const h = server(200);
	await h.store.start();
	expect(shown(h.store).at(-1)).toBe('reply 200');
	await h.store.openLink({ message: 'outbox-100' });
	expect(h.calls).toContain('around:outbox-100');
	expect(h.store.detached).toBe(true);
	expect(h.store.hasNewer).toBe(true);
	expect(h.store.hasOlder).toBe(true);
	expect(h.store.landing).toMatchObject({ state: 'found', messageId: 'h:100', at: reply(100).at });
	expect(shown(h.store)[0]).toBe('reply 75');
	expect(shown(h.store)).toContain('reply 100');
	h.add(201);
	await Bun.sleep(20);
	// Not appended into the window in the wrong place; the live chat has it.
	expect(shown(h.store)).not.toContain('reply 201');
	expect(h.store.items.some((i) => i.kind === 'assistant' && i.key === 'outbox-201')).toBe(true);
	// The same link again keeps the place it landed.
	const landed = h.store.landing;
	await h.store.openLink({ message: 'outbox-100' });
	expect(h.store.landing).toBe(landed);
	// Older pages load into the window.
	await h.store.loadOlder();
	expect(shown(h.store)[0]).toBe('reply 35');
	expect(h.store.hasOlder).toBe(true);
	// Jump to latest: back to the live chat, newest included.
	h.store.leaveLink();
	expect(h.store.detached).toBe(false);
	expect(h.store.landing).toBeNull();
	expect(shown(h.store).at(-1)).toBe('reply 201');
});

test('paging newer reaches the newest page and joins the live chat in place', async () => {
	const h = server(120);
	await h.store.start();
	await h.store.openLink({ message: 'outbox-30' });
	h.add(121);
	await Bun.sleep(20);
	let pages = 0;
	while (h.store.detached && pages++ < 10) await h.store.loadNewer();
	expect(h.store.detached).toBe(false);
	expect(h.store.hasNewer).toBe(false);
	const rows = shown(h.store);
	expect(rows[0]).toBe('reply 5');
	expect(rows.at(-1)).toBe('reply 121');
	expect(new Set(rows).size).toBe(rows.length);
	expect(rows).toHaveLength(117);
	// The joined chat pages older from the window's oldest row.
	await h.store.loadOlder();
	expect(shown(h.store)[0]).toBe('reply 1');
});

test('a message the live chat already holds lands in place, with no window', async () => {
	const h = server(60);
	await h.store.start();
	await h.store.openLink({ message: 'outbox-55' });
	expect(h.calls.filter((c) => c.startsWith('around'))).toEqual([]);
	expect(h.store.detached).toBe(false);
	expect(h.store.landing).toMatchObject({ state: 'found', messageId: 'h:55' });
});

test('rows outside the live pages open a window, by key or by s<seq>', async () => {
	const h = server(60);
	await h.store.start();
	await h.store.openLink({ message: 's12' });
	expect(h.store.detached).toBe(true);
	h.store.leaveLink();
	await h.store.openLink({ message: 'outbox-10' });
	expect(h.store.detached).toBe(true);
	h.store.leaveLink();
	// Just below the newest 40: still a window, which pages newer to join.
	const near = server(60);
	await near.store.start();
	near.store.leaveLink();
	await near.store.openLink({ message: 'outbox-15' });
	expect(near.store.detached).toBe(true);
	near.store.leaveLink();
	await near.store.openLink({ message: 'outbox-19' });
	expect(near.store.landing).toMatchObject({ state: 'found' });
});

test('a missing message lands on the nearest one with its seq, else on the newest messages', async () => {
	const h = server(200);
	h.all.splice(49, 1); // reply 50 is gone
	await h.store.start();
	await h.store.openLink({ message: 's50' });
	expect(h.store.landing).toMatchObject({ state: 'missing', messageId: 'h:51' });
	expect(h.store.detached).toBe(true);
	await h.store.openLink({ message: 'never-existed-1' });
	expect(h.store.landing?.state).toBe('missing');
	expect(h.store.landing?.messageId).toBeUndefined();
	expect(h.store.detached).toBe(false);
});

test('a linked question the stream delivers later lands when it arrives', async () => {
	const h = server(10);
	await h.store.start();
	await h.store.openLink({ ask: 'later-question' });
	expect(h.store.landing?.state).toBe('missing');
	h.push({
		type: 'ask',
		seq: 11,
		data: { key: 'ask-outbox', askId: 'later-question', question: 'Which?', choices: ['A'] }
	});
	await Bun.sleep(20);
	expect(h.store.landing).toMatchObject({ state: 'found', askId: 'later-question' });
});

test('a failed around load is an error the screen can retry', async () => {
	const h = server(100, { failAround: 1 });
	await h.store.start();
	await h.store.openLink({ message: 'outbox-10' });
	expect(h.store.landing?.state).toBe('error');
	expect(h.store.detached).toBe(false);
	// Without retry, the same failed link loads again too.
	await h.store.openLink({ message: 'outbox-10' }, true);
	expect(h.store.landing).toMatchObject({ state: 'found', messageId: 'h:10' });
	expect(h.store.detached).toBe(true);
});
