import { expect, test } from 'bun:test';
import {
	agentAge,
	agentState,
	placeRequests,
	choices,
	groupAgents,
	pendingRequests,
	requestKey,
	requestView,
	turns,
	workSummary
} from './model';
import type { AgentRecord, TranscriptItem } from './types';

const agent = (id: string, patch: Partial<AgentRecord>, updatedAt = '2026-10-12T11:00:00Z') =>
	({
		id,
		machineId: 'pc',
		machineName: 'Desktop',
		rootId: 'code',
		folder: 'Code',
		provider: 'codex',
		title: id,
		conversationId: 'main',
		createdAt: '2026-10-12T10:00:00Z',
		updatedAt,
		...patch
	}) satisfies AgentRecord;

test('agents waiting on the owner come first, failures and stalls with them; finished agents are neutral', () => {
	const groups = groupAgents([
		agent('done', { remoteStatus: 'completed' }),
		agent('run', { remoteStatus: 'running' }),
		agent('fail', { remoteStatus: 'failed', error: 'exit 1' }, '2026-10-12T11:30:00Z'),
		agent('ask', { remoteStatus: 'needs-you', requests: 2, requestTitle: 'Run: bun test' }),
		agent('quiet', { remoteStatus: 'running', stalled: true }),
		agent('stop', { remoteStatus: 'stopped' })
	]);
	expect(groups['needs-you'].map((a) => a.id)).toEqual(['ask', 'fail', 'quiet']);
	expect(groups.working.map((a) => a.id)).toEqual(['run']);
	expect(groups.finished.map((a) => a.id).sort()).toEqual(['done', 'stop']);
	expect(agentState(agent('d', { remoteStatus: 'completed' }))).toMatchObject({
		of: 'done',
		label: 'Finished',
		detail: 'Unverified'
	});
	expect(
		agentState(agent('a', { remoteStatus: 'needs-you', requestTitle: 'Run: ls' })).detail
	).toBe('Run: ls');
});

test('the badge counts requests, not agents, and ignores failures', () => {
	expect(
		pendingRequests([
			agent('a', { remoteStatus: 'needs-you', requests: 2 }),
			agent('b', { remoteStatus: 'needs-you' }),
			agent('c', { remoteStatus: 'failed' })
		])
	).toBe(3);
});

test("age runs while live and freezes at the run's length", () => {
	const now = Date.parse('2026-10-12T12:00:00Z');
	expect(agentAge(agent('r', { remoteStatus: 'running' }), now)).toBe('2h');
	expect(agentAge(agent('d', { remoteStatus: 'completed' }), now)).toBe('1h');
});

test('a transcript becomes turns: prompt, work, then the answer; commentary stays in the work', () => {
	const at = (s: number) => new Date(Date.parse('2026-10-12T10:00:00Z') + s * 1000).toISOString();
	const items: TranscriptItem[] = [
		{ kind: 'prompt', origin: 'agent', text: 'Fix it', at: at(0) },
		{ kind: 'message', text: 'Looking', at: at(1) },
		{ kind: 'command', command: 'bun test', exitCode: 1, at: at(2) },
		{ kind: 'fileChange', files: [{ path: 'a.ts', change: 'update' }], at: at(3) },
		{ kind: 'fileChange', files: [{ path: 'a.ts', change: 'update' }], at: at(4) },
		{ kind: 'message', text: 'Fixed', final: true, at: at(5) },
		{ kind: 'message', text: 'Afterthought', at: at(6) },
		{ kind: 'turnEnd', status: 'completed', at: at(134) },
		{ kind: 'prompt', origin: 'owner', text: 'And docs', at: at(200) },
		{ kind: 'command', command: 'ls', at: at(201) }
	];
	const [first, second] = turns(items);
	expect(first!.prompt?.origin).toBe('agent');
	expect(first!.answer?.text).toBe('Fixed');
	expect(first!.work.map((i) => i.kind)).toEqual([
		'message',
		'command',
		'fileChange',
		'fileChange',
		'message'
	]);
	expect(workSummary(first!, 0)).toEqual({
		text: 'Worked 2m 14s · 1 command · 1 file · 1 failed',
		failed: 1,
		pending: 0
	});
	// A running turn has no answer yet, even with messages.
	expect(second!.answer).toBeUndefined();
	expect(workSummary(second!, Date.parse(at(241))).text).toBe('Working 41s · 1 command');
});

test('an approval shows the exact thing approved, and approving for the turn is not a button', () => {
	expect(
		requestView({
			id: 1,
			description: 'x',
			decisions: ['accept'],
			detail: { kind: 'command', host: 'example.com', protocol: 'https' }
		})
	).toEqual({ title: 'Allow network access to example.com', exact: 'https example.com' });
	expect(choices(['accept', 'acceptForSession', 'decline', 'cancel']).map((c) => c.label)).toEqual([
		'Approve',
		'Deny'
	]);
	expect(choices(['decline']).map((c) => c.label)).toEqual(['Decline']);
	expect(requestKey(1)).not.toBe(requestKey('1'));
});

test('a request id reused by a later turn shows one live card, in that turn; the earlier one stays answered', () => {
	const items: TranscriptItem[] = [
		{ kind: 'prompt', origin: 'agent', text: 'One', at: 'a' },
		{ kind: 'approval', requestId: 'req-1', title: 'Run: ls', status: 'accepted', at: 'b' },
		{ kind: 'turnEnd', status: 'completed', at: 'c' },
		{ kind: 'prompt', origin: 'owner', text: 'Two', at: 'd' },
		{ kind: 'approval', requestId: 'req-1', title: 'Run: rm', status: 'pending', at: 'e' }
	];
	const all = turns(items);
	const request = { id: 'req-1', description: 'Run: rm', decisions: ['accept' as const] };
	const placed = placeRequests(all, [request]);
	expect([...placed.byTurn.keys()]).toEqual([1]);
	expect(placed.loose).toEqual([]);
	expect([...placed.items]).toEqual([all[1]!.work[0]]);
	expect(placed.items.has(all[0]!.work[0]!)).toBe(false);
	// A request no pending item names still shows, after the transcript.
	expect(placeRequests(turns(items.slice(0, 3)), [request]).loose).toEqual([request]);
});
