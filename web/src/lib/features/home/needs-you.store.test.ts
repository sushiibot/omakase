/// <reference types="bun" />
import { afterAll, afterEach, beforeEach, expect, jest, test } from 'bun:test';
import { createHub } from '$lib/core/realtime/hub.svelte';
import { fakeTransport } from '$lib/core/realtime/fake-transport';
import type { HomeItemRating, JobAlert } from '$lib/core/realtime/events';
import { HttpError } from '$lib/core/http';
import type { ChatApi } from '$lib/features/chat';
import type { HomeApi } from './api';
import { HEARTBEAT_ITEMS_KEY, HEARTBEAT_KEY, homeData, nightlyAlert, RUN_IDS } from './fixtures';
import { NeedsYouStore } from './needs-you.svelte';
import type { HomeData } from './types';

import { advance, restoreTimers, settle } from '../../../../tests/timers';

beforeEach(() => {
	jest.useFakeTimers();
});
afterEach(restoreTimers);

const g = globalThis as unknown as { document?: unknown };
// Removed after this file: a leftover document makes later files' UI libraries assume window exists.
const stubbedDocument = g.document === undefined;
if (stubbedDocument)
	g.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
afterAll(() => {
	if (stubbedDocument) delete g.document;
});

const NOW = Date.now();
const job: JobAlert = {
	source: 'job',
	job: 'nightly-sync',
	kind: 'failed',
	trigger: 'daily',
	startedAt: new Date(NOW).toISOString(),
	schedule: 'daily 02:00'
};

/** A Home API whose answers the test sets, counting loads. */
interface Server {
	data: HomeData | null;
	loads: number;
	dismissed: string[];
	opened: string[];
	restored: string[];
	rated: [string, string, HomeItemRating | null][];
	rateFails: boolean;
	api: HomeApi;
}

function server(first: HomeData | null = homeData(NOW)): Server {
	const s: Server = {
		data: first,
		loads: 0,
		dismissed: [] as string[],
		opened: [] as string[],
		restored: [] as string[],
		rated: [],
		rateFails: false,
		api: {
			load: async () => {
				s.loads++;
				return s.data;
			},
			dismiss: async (id: string) => void s.dismissed.push(id),
			opened: async (id: string) => void s.opened.push(id),
			restore: async (id: string) => void s.restored.push(id),
			rate: async (id, key, rating) => {
				if (s.rateFails) throw new HttpError(503, 'offline');
				s.rated.push([id, key, rating]);
			},
			muted: async () => [],
			unmute: async () => []
		}
	};
	return s;
}

async function setup(first?: HomeData | null) {
	const stream = fakeTransport();
	const hub = createHub({ transport: stream.transport });
	const srv = server(first);
	const home = new NeedsYouStore({ hub, api: srv.api, chat: () => ({}) as ChatApi });
	home.open();
	await advance(16);
	return { stream, hub, srv, home };
}

const ids = (home: NeedsYouStore) => Object.values(home.groups).flatMap((g) => g.map((i) => i.id));

test('run and alert events refetch the server part once per burst', async () => {
	const { stream, srv, hub } = await setup();
	expect(srv.loads).toBe(1);
	stream.emit('run', { runId: RUN_IDS.flights, kind: 'subagent', status: 'done' }, false);
	stream.emit('alert', { key: 'o1', alert: job, text: 't' });
	stream.emit('alert_cleared', { id: 'job:other', reason: 'recovered' });
	hub.flush();
	await advance(999);
	expect(srv.loads).toBe(1);
	await advance(1);
	expect(srv.loads).toBe(2);
});

test('a dismissed alert stays hidden until a load after the dismissal, then the server decides', async () => {
	const { home, srv } = await setup();
	expect(ids(home)).toContain('job:nightly-sync');
	await home.dismiss('job:nightly-sync');
	expect(srv.dismissed).toEqual(['job:nightly-sync']);
	expect(ids(home)).not.toContain('job:nightly-sync');
	// The bot drops it; then a later streak fails again and the bot lists it once more.
	srv.data = {
		...homeData(NOW),
		failed: homeData(NOW).failed.filter((a) => a.job !== 'nightly-sync')
	};
	await home.data.refetch();
	expect(ids(home)).not.toContain('job:nightly-sync');
	srv.data = homeData(NOW);
	await home.data.refetch();
	expect(ids(home)).toContain('job:nightly-sync');
});

test('alert_cleared hides the alert at once; a new failure for the job brings it back', async () => {
	const { home, stream, srv } = await setup();
	stream.emit('alert_cleared', { id: 'job:nightly-sync', reason: 'recovered' });
	await advance(16);
	expect(ids(home)).not.toContain('job:nightly-sync');
	stream.emit('alert', { key: 'o2', alert: job, text: 't' });
	await advance(16);
	expect(ids(home)).toContain('job:nightly-sync');
	srv.data = { ...homeData(NOW), failed: [nightlyAlert(NOW)] };
	await advance(1000);
	expect(ids(home)).toContain('job:nightly-sync');
});

test('with Home off on the bot, the stream part still shows and nothing is posted', async () => {
	const { home, srv } = await setup(null);
	expect(home.data.status).toBe('ready');
	expect(home.data.data).toBeNull();
	home.markOpened(RUN_IDS.expenses);
	expect(srv.opened).toEqual([]);
	expect(home.groups.failed).toEqual([]);
});

test('opening a run posts it once and shows it read, still in the inbox', async () => {
	const { home, srv } = await setup();
	const id = `run:${RUN_IDS.expenses}`;
	home.markOpened(RUN_IDS.expenses);
	home.markOpened(RUN_IDS.expenses);
	await settle();
	expect(srv.opened).toEqual([id]);
	expect(home.groups.review.find((i) => i.id === id)).toMatchObject({ read: true });
});

test('done hides an item at once and Undo brings it back after the done lands', async () => {
	const { home, srv } = await setup();
	const id = `msg:${HEARTBEAT_KEY}`;
	home.done(id, 'From heartbeat');
	expect(ids(home)).not.toContain(id);
	expect(home.undoable).toEqual({ id, label: 'From heartbeat' });
	await home.undo();
	expect(srv.dismissed).toEqual([id]);
	expect(srv.restored).toEqual([id]);
	expect(home.undoable).toBeNull();
	expect(ids(home)).toContain(id);
});

test('a rating shows at once, reaches the server, and rolls back with a reason when it fails', async () => {
	const { srv, home } = await setup();
	const item = home.groups.review.find((i) => i.id === `msg:${HEARTBEAT_ITEMS_KEY}`)!;
	const id = `msg:${HEARTBEAT_ITEMS_KEY}:lucid:mutants:main`;
	await home.rate(item, 'lucid:mutants:main', { value: 'down', scope: 'topic' });
	expect(srv.rated).toEqual([
		[`msg:${HEARTBEAT_ITEMS_KEY}`, 'lucid:mutants:main', { value: 'down', scope: 'topic' }]
	]);
	expect(home.ratings[id]).toEqual({ value: 'down', scope: 'topic' });
	srv.rateFails = true;
	await home.rate(item, 'lucid:mutants:main', null);
	expect(home.ratings[id]).toEqual({ value: 'down', scope: 'topic' });
	expect(home.results[`msg:${HEARTBEAT_ITEMS_KEY}`]?.text).toContain('offline');
});

test("a reply to a job item goes to Main with the item's ref, shows at once, and rolls back if it can't be sent", async () => {
	const stream = fakeTransport();
	const hub = createHub({ transport: stream.transport });
	const srv = server();
	const sent: { text: string; ref: unknown }[] = [];
	let ok = true;
	const home = new NeedsYouStore({
		hub,
		api: srv.api,
		chat: () => ({}) as ChatApi,
		main: () => ({
			start: async () => {},
			send: async (text, _files, { ref }) => {
				sent.push({ text, ref });
				return ok;
			}
		})
	});
	home.open();
	await advance(16);
	const item = home.groups.review.find((i) => i.id === `msg:${HEARTBEAT_ITEMS_KEY}`)!;
	await home.reply(item, 'lucid:mutants:main', 'Remind me tomorrow', 1);
	expect(sent).toEqual([
		{
			text: 'Remind me tomorrow',
			ref: {
				input: { id: `msg:${HEARTBEAT_ITEMS_KEY}`, item: 'lucid:mutants:main', choice: 1 },
				view: expect.objectContaining({
					job: 'heartbeat',
					runId: RUN_IDS.weeklyDeps,
					item: { key: 'lucid:mutants:main', title: 'lucid mutation tests failing' },
					choice: 'Remind me tomorrow'
				})
			}
		}
	]);
	expect(home.answers[`msg:${HEARTBEAT_ITEMS_KEY}:lucid:mutants:main`]).toBe('Remind me tomorrow');
	expect(home.results[`msg:${HEARTBEAT_ITEMS_KEY}`]?.ok).toBe(true);

	ok = false;
	await home.reply(item, 'sushii:deploy-reviews', 'Later');
	expect(home.answers[`msg:${HEARTBEAT_ITEMS_KEY}:sushii:deploy-reviews`]).toBeUndefined();
	expect(home.results[`msg:${HEARTBEAT_ITEMS_KEY}`]?.ok).toBe(false);
	// An unknown item or choice sends nothing.
	await home.reply(item, 'gone', 'x');
	await home.reply(item, 'lucid:mutants:main', 'x', 7);
	expect(sent).toHaveLength(2);
});
