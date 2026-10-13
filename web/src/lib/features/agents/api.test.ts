import { expect, test } from 'bun:test';
import { choices, requestKey, requestView, visibleAgents, type AgentRecord } from './api';

const agent = (id: string, remoteStatus: AgentRecord['remoteStatus'], updatedAt: string) =>
	({
		id,
		machineId: 'pc',
		machineName: 'Desktop',
		rootId: 'code',
		provider: 'codex',
		title: id,
		conversationId: 'main',
		remoteStatus,
		createdAt: updatedAt,
		updatedAt
	}) satisfies AgentRecord;

test('agents waiting on the owner always show first, ahead of any number of finished ones', () => {
	const now = Date.parse('2026-10-12T12:00:00Z');
	const recent = '2026-10-12T11:00:00Z';
	const finished = Array.from({ length: 8 }, (_, i) => agent(`done-${i}`, 'completed', recent));
	const shown = visibleAgents(
		[
			...finished,
			agent('run', 'running', recent),
			agent('ask', 'needs-you', '2026-09-01T00:00:00Z'),
			agent('old', 'failed', '2026-10-10T00:00:00Z')
		],
		now
	);
	expect(shown.slice(0, 2).map((a) => a.id)).toEqual(['ask', 'run']);
	expect(shown).toHaveLength(7);
	expect(shown.some((a) => a.id === 'old')).toBe(false);
});

test('the exact input leads, and approving for the turn is not a decision button', () => {
	expect(
		requestView({
			id: 1,
			description: 'x',
			decisions: ['accept'],
			detail: { kind: 'command', host: 'example.com', protocol: 'https' }
		})
	).toEqual({ title: 'Network access', exact: 'https example.com' });
	expect(choices(['accept', 'acceptForSession', 'decline', 'cancel']).map((c) => c.label)).toEqual([
		'Approve',
		'Deny'
	]);
	expect(choices(['decline']).map((c) => c.label)).toEqual(['Decline']);
	expect(requestKey(1)).not.toBe(requestKey('1'));
});
