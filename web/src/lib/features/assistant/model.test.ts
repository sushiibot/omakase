import { expect, test } from 'bun:test';
import {
	greeting,
	homeWork,
	needsYouCount,
	needsYouList,
	recentConversations,
	summaryLine,
	workingNow
} from './model';
import type { HomeGroups, HomeItem } from '$lib/features/home';
import { taskFixtures } from '$lib/features/tasks/fixtures';
import { channelFixture } from '$lib/features/channels/fixtures';

const groups: HomeGroups = {
	waiting: [],
	failed: [],
	review: [],
	running: [
		{
			id: 'run:a',
			kind: 'run',
			group: 'running',
			at: '',
			run: {
				runId: 'a',
				title: 'Same title',
				kind: 'agent',
				agentName: 'agent',
				status: 'running',
				startedAt: ''
			}
		},
		{
			id: 'run:b',
			kind: 'run',
			group: 'running',
			at: '',
			run: {
				runId: 'b',
				title: 'Same title',
				kind: 'agent',
				agentName: 'agent',
				status: 'running',
				startedAt: ''
			}
		}
	]
};
test('Home groups only runs linked to a running task, without mutating sources', () => {
	const task = {
		...taskFixtures[0]!,
		title: 'Same title',
		status: 'in-progress' as const,
		runIds: ['a']
	};
	const result = homeWork([task], groups);
	expect(result.runs.map((r) => r.id)).toEqual(['run:b']);
	expect(result.running).toEqual([task]);
	expect(groups.running).toHaveLength(2);
	expect(homeWork([{ ...task, status: 'done' }], groups).runs).toHaveLength(2);
});
test('Recent conversations use chat visits and remove missing and archived records', () => {
	const channels = [
		channelFixture('a', 'Alpha', { preview: 'Hi', hasNewMessages: true }),
		channelFixture('b', 'Beta', { state: 'archived' }),
		channelFixture('c', 'Gamma'),
		channelFixture('d', 'Delta'),
		channelFixture('e', 'Epsilon'),
		channelFixture('f', 'Zeta')
	];
	expect(recentConversations(channels, [])).toEqual([]);
	const recent = recentConversations(channels, ['missing', 'b', 'a', 'c', 'd', 'e', 'f']);
	expect(recent.map((i) => i.href)).toEqual(['/chats/a', '/chats/c', '/chats/d', '/chats/e']);
	expect(recent[0]).toMatchObject({ title: 'Alpha', preview: 'Hi', unread: true });
	expect(recent[1]!.unread).toBe(false);
});

const approval = (nonce: string, conversationId?: string): HomeItem => ({
	id: `approval:${nonce}`,
	group: 'waiting',
	kind: 'approval',
	at: '2026-10-11T12:00:00Z',
	approval: {
		nonce,
		view: { tool: 'send_email', agentId: 'main', agentName: 'agent', fields: [], conversationId }
	}
});
const empty: HomeGroups = { waiting: [], failed: [], running: [], review: [] };

test('Needs you counts each request id once, across Home and every conversation', () => {
	const trip = channelFixture('trip', 'October trip', {
		pending: { asks: 1, approvals: 1, total: 2 },
		attention: [
			{ kind: 'approval', id: 'n1', seq: 1, at: '2026-10-11T12:00:00Z' },
			{ kind: 'ask', id: 'q1', seq: 2, at: '2026-10-11T12:01:00Z' }
		]
	});
	const main = channelFixture('main', 'Main', {
		pending: { asks: 0, approvals: 1, total: 1 },
		attention: [{ kind: 'approval', id: 'm1', seq: 1, at: '2026-10-11T12:00:00Z' }]
	});
	const groups: HomeGroups = { ...empty, waiting: [approval('n1', 'trip'), approval('m1')] };
	const list = needsYouList(groups, [main, trip], []);
	expect(list.requests.map((r) => [r.item.id, r.context])).toEqual([
		['approval:n1', 'October trip'],
		['approval:m1', undefined]
	]);
	// The topic's question has no Home record: it links to the question in its conversation.
	expect(list.channels).toHaveLength(1);
	expect(list.channels[0]).toMatchObject({
		ids: ['ask:q1'],
		kind: 'ask',
		href: '/chats/trip?ask=q1'
	});
	expect(list.count).toBe(3);
	// Before the catalog loads, Home's own records count.
	expect(needsYouCount(groups, [], [])).toBe(2);
	// Failures are a separate count.
	const failed: HomeItem = {
		id: 'job:x',
		group: 'failed',
		kind: 'alert',
		at: '',
		alert: { id: 'job:x', job: 'x', kind: 'failed', schedule: '', lastAt: '' } as never
	};
	expect(needsYouCount({ ...groups, failed: [failed] }, [main, trip], [])).toBe(3);
});

test('Waiting tasks count once, unless a request in their conversation already does', () => {
	const task = { ...taskFixtures[0]!, status: 'needs-you' as const };
	expect(needsYouList(empty, [], [task]).tasks).toEqual([task]);
	expect(needsYouCount(empty, [], [task])).toBe(1);
	const channel = channelFixture('task-t-login', 'Fix login redirect', {
		kind: 'task',
		taskId: task.id,
		pending: { asks: 1, approvals: 0, total: 1 },
		attention: [{ kind: 'ask', id: 'q2', seq: 1, at: '' }]
	});
	const list = needsYouList(empty, [channel], [task]);
	expect(list.tasks).toEqual([]);
	expect(list.channels[0]!.href).toBe('/tasks/t-login?view=conversation&ask=q2');
	expect(list.count).toBe(1);
});

test('Working now lists Main turns with their step, running conversations, tasks and runs', () => {
	const turn: HomeItem = {
		id: 'turn:t1',
		group: 'running',
		kind: 'turn',
		at: '2026-10-11T12:00:00Z',
		turn: { turnId: 't1', startedAt: 0, step: 'Searching email', toolCount: 1 }
	};
	const channels = [
		channelFixture('main', 'Sushii', { activity: { running: true, turnCount: 1 } }),
		channelFixture('design', 'UI redesign', { activity: { running: true, turnCount: 2 } }),
		channelFixture('old', 'Old', { state: 'archived', activity: { running: true, turnCount: 1 } })
	];
	const task = { ...taskFixtures[0]!, status: 'in-progress' as const, runIds: ['a'] };
	const rows = workingNow({ ...groups, running: [turn, ...groups.running] }, channels, [task]);
	expect(rows.map((r) => r.id)).toEqual(['turn:t1', 'chat:design', `task:${task.id}`, 'run:b']);
	expect(rows[0]).toMatchObject({
		title: 'Sushii',
		step: 'Working: Searching email',
		href: '/chat?turn=t1'
	});
	expect(rows[1]).toMatchObject({ step: 'Working on 2 replies', href: '/chats/design' });
	// Without a live turn, Main's catalog activity still shows.
	expect(workingNow(empty, channels, []).map((r) => r.id)).toEqual(['chat:main', 'chat:design']);
});

test('The status line greets by local time and leaves out what is zero', () => {
	expect(greeting(new Date(2026, 9, 19, 8).getTime())).toBe('Good morning');
	expect(greeting(new Date(2026, 9, 19, 14).getTime())).toBe('Good afternoon');
	expect(greeting(new Date(2026, 9, 19, 23).getTime())).toBe('Good evening');
	expect(summaryLine({ need: 2, failed: 1, running: 3, ready: 4 })).toBe(
		'2 need you · 1 failed · 3 running · 4 ready'
	);
	expect(summaryLine({ need: 1, failed: 0, running: 0, ready: 0 })).toBe('1 needs you');
	expect(summaryLine({ need: 0, failed: 0, running: 2, ready: 1 })).toBe(
		'Nothing needs you · 2 running · 1 ready'
	);
	expect(summaryLine({ need: 0, failed: 0, running: 0, ready: 0 })).toBe('All clear');
});
