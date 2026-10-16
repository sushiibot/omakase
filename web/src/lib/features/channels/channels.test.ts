import { expect, test } from 'bun:test';
import type { Hub } from '$lib/core/realtime/hub.svelte';
import type { ChatEnvelope } from '$lib/core/realtime/events';
import { ChannelsStore, CHANNEL_VISITS_KEY, type ChannelVisitsStorage } from './channels.svelte';
import { channelHref, selectChannels } from './navigation';
import { channelCatalogFixture, channelFixture } from './fixtures';
import { createFixtureChannelsApi } from './fake';
import { createFixtureThreadsApi } from '../threads/fake';
import { createFixtureTasksApi } from '../tasks/fake';
const ids = (channels: ReturnType<typeof selectChannels>) => channels.map((channel) => channel.id);
function storage(initial: string | null = null): ChannelVisitsStorage {
	let value = initial;
	return {
		getItem: () => value,
		setItem: (_key, next) => {
			value = next;
		}
	};
}
function realtime() {
	let receive: ((events: readonly ChatEnvelope[]) => void) | undefined;
	let starts = 0;
	let subscriptions = 0;
	const fake: Hub = {
		connection: 'open',
		reconnectingSince: null,
		workspace: 'online',
		headSeq: 0,
		start: () => {
			starts++;
		},
		stop: () => {},
		flush: () => {},
		useTransport: () => {},
		onState: () => () => {},
		subscribe: (_filter, callback) => {
			receive = callback;
			subscriptions++;
			return () => {
				subscriptions--;
				receive = undefined;
			};
		}
	};
	return {
		hub: fake,
		emit: (events: readonly ChatEnvelope[]) => receive?.(events),
		get starts() {
			return starts;
		},
		get subscriptions() {
			return subscriptions;
		}
	};
}
const delay = () => new Promise((resolve) => setTimeout(resolve, 180));
test('All stays alphabetical despite background updates; Main stays first and archive is explicit', () => {
	const catalog = channelCatalogFixture();
	const expected = ['main', 'deployment', 'task-t-release', 'travel', 'design'];
	expect(ids(selectChannels(catalog.channels, 'all', []))).toEqual(expected);
	catalog.channels.reverse();
	catalog.channels[0].lastActivity = '2099-01-01T12:00:00Z';
	expect(ids(selectChannels(catalog.channels, 'all', []))).toEqual(expected);
	expect(ids(selectChannels(catalog.channels, 'all', [], { includeArchived: true }))).toContain(
		'old'
	);
	expect(ids(selectChannels(catalog.channels, 'all', [], { search: 'old' }))).toEqual(['old']);
	expect(ids(selectChannels(catalog.channels, 'needs-you', []))).toEqual(['deployment']);
});
test('Recent changes only on explicit visits, persists and never changes the catalog order', async () => {
	const catalog = channelCatalogFixture();
	const saved = storage();
	const deps = { api: { list: async () => catalog }, hub: realtime().hub, storage: saved };
	const store = new ChannelsStore(deps);
	await store.list.ensure();
	store.visit('design');
	store.visit('travel');
	store.visit('design');
	expect(store.recentIds).toEqual(['design', 'travel']);
	expect(ids(store.visible('recent')).slice(0, 3)).toEqual(['main', 'design', 'travel']);
	const original = catalog.channels.map((channel) => channel.id);
	catalog.channels.find((channel) => channel.id === 'deployment')!.lastActivity =
		'2099-01-01T12:00:00Z';
	await store.list.refetch();
	expect(ids(store.visible('recent')).slice(0, 3)).toEqual(['main', 'design', 'travel']);
	expect(catalog.channels.map((channel) => channel.id)).toEqual(original);
	expect(new ChannelsStore(deps).recentIds).toEqual(['design', 'travel']);
	expect(saved.getItem(CHANNEL_VISITS_KEY)).toBe('["design","travel"]');
});
test('storage failure or malformed history does not block navigation', () => {
	const deps = { api: { list: async () => channelCatalogFixture() }, hub: realtime().hub };
	expect(new ChannelsStore({ ...deps, storage: storage('{bad') }).recentIds).toEqual([]);
	expect(
		new ChannelsStore({ ...deps, storage: storage('["travel",null,"travel",5]') }).recentIds
	).toEqual(['travel']);
	const store = new ChannelsStore({
		...deps,
		storage: {
			getItem: () => {
				throw Error('blocked');
			},
			setItem: () => {
				throw Error('blocked');
			}
		}
	});
	store.visit('travel');
	expect(store.recentIds).toEqual(['travel']);
	for (let i = 0; i < 120; i++) store.visit(`channel-${i}`);
	expect(store.recentIds).toHaveLength(100);
});
test('canonical channel routes preserve Main, topic and task destinations', () => {
	expect(channelHref(channelFixture('main', 'Main'))).toBe('/chat');
	expect(channelHref(channelFixture('travel', 'Travel'))).toBe('/chats/travel');
	expect(
		channelHref(channelFixture('task-t-release', 'Release', { kind: 'task', taskId: 't-release' }))
	).toBe('/tasks/t-release?view=conversation');
});
test('SSE invalidations and reconnect refresh once per burst while watched, then unsubscribe', async () => {
	const fake = realtime();
	let loads = 0;
	const store = new ChannelsStore({
		api: {
			list: async () => {
				loads++;
				return channelCatalogFixture();
			}
		},
		hub: fake.hub,
		storage: null
	});
	const stopA = store.watch();
	const stopB = store.watch();
	await store.list.ensure();
	expect(fake.starts).toBe(1);
	expect(fake.subscriptions).toBe(1);
	expect(loads).toBe(1);
	fake.emit([
		{ type: 'threads', data: { id: 'deployment' } },
		{ type: 'threads', data: { id: 'main' } }
	]);
	fake.emit([{ type: 'threads', data: { id: 'design' } }]);
	await delay();
	expect(loads).toBe(2);
	fake.emit([
		{
			type: 'reset',
			data: { headSeq: 5, workspace: 'online', pending: { asks: [], approvals: [] } }
		}
	]);
	await delay();
	expect(loads).toBe(3);
	stopA();
	stopA();
	expect(fake.subscriptions).toBe(1);
	fake.emit([{ type: 'threads', data: { id: 'design' } }]);
	stopB();
	await delay();
	expect(fake.subscriptions).toBe(0);
	expect(loads).toBe(3);
});
test('channel fixtures share thread mutations and add only tasks with work conversations', async () => {
	const threads = createFixtureThreadsApi(() => 'normal');
	const tasks = createFixtureTasksApi();
	const api = createFixtureChannelsApi({ threads, tasks });
	const before = await api.list();
	expect(before.channels.some((channel) => channel.taskId === 't-login')).toBe(true);
	expect(before.channels.some((channel) => channel.taskId === 't-dentist')).toBe(false);
	const added = await threads.branch({ messageId: '', title: 'Shared fixture' });
	await threads.close(added.id);
	expect((await api.list()).channels.find((channel) => channel.id === added.id)!.state).toBe(
		'archived'
	);
	await threads.reopen(added.id);
	expect((await api.list()).channels.find((channel) => channel.id === added.id)!.state).toBe(
		'idle'
	);
	await tasks.action({ action: 'start', id: 't-dentist' });
	expect((await api.list()).channels.find((channel) => channel.taskId === 't-dentist')!.kind).toBe(
		'task'
	);
	expect((await api.list()).channels.every((channel) => channel.unread === null)).toBe(true);
});

test('read positions persist per channel and new messages become unread again', async () => {
	const values = new Map<string, string>();
	const saved = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		}
	};
	const catalog = {
		channels: [channelFixture('main', 'Main', { lastMessageSeq: 7 })],
		archiveAfterDays: 7
	};
	const api = { list: async () => catalog };
	const store = new ChannelsStore({ api, storage: saved, hub: realtime().hub });
	await store.list.ensure();
	const channel = store.list.data!.channels.find((c) => c.lastMessageSeq !== null)!;
	expect(store.visible().find((c) => c.id === channel.id)?.hasNewMessages).toBe(true);
	store.markRead(channel.id, channel.lastMessageSeq);
	expect(store.visible().find((c) => c.id === channel.id)?.hasNewMessages).toBe(false);
	const reopened = new ChannelsStore({ api, storage: saved, hub: realtime().hub });
	await reopened.list.ensure();
	expect(reopened.visible().find((c) => c.id === channel.id)?.hasNewMessages).toBe(false);
	reopened.markRead(channel.id, channel.lastMessageSeq! - 1);
	expect(reopened.readSequences[channel.id]).toBe(channel.lastMessageSeq!);
	catalog.channels[0] = { ...channel, lastMessageSeq: 8 };
	await reopened.list.refetch();
	expect(reopened.visible()[0].hasNewMessages).toBe(true);
});
