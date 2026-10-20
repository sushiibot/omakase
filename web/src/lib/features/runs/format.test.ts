/// <reference types="bun" />
import { expect, test } from 'bun:test';
import {
	activityTitle,
	filterKinds,
	kindLabel,
	runConversationHref,
	runResultHref,
	runTrigger
} from './format';

test('Work separates assignments from conversation replies and maintenance', () => {
	expect(filterKinds('work')).toEqual(['job', 'subagent', 'agent']);
	expect(filterKinds('chat')).toEqual(['chat']);
	expect(filterKinds('all')).toBeUndefined();
	expect(kindLabel({ kind: 'subagent', agentName: 'coder' })).toBe('Delegated · coder');
	expect(kindLabel({ kind: 'rotate', agentName: 'main' })).toBe('Context refresh');
});

test('long requests get an honest compact heading without inventing a summary', () => {
	expect(
		activityTitle({
			kind: 'subagent',
			agentName: 'coder',
			title: 'Read AGENTS and replace the image. '.repeat(10)
		})
	).toBe('coder task');
	expect(
		activityTitle({ kind: 'chat', agentName: 'main', title: 'Why did you ask permission?' })
	).toBe('Reply activity');
	expect(activityTitle({ kind: 'agent', agentName: 'coder', title: 'Replace drink photo' })).toBe(
		'Replace drink photo'
	);
});

test('conversation jumps preserve topic and task destinations and inherit a parent turn', () => {
	const base = {
		runId: 'run',
		title: 'Work',
		status: 'done' as const,
		startedAt: '2026-10-01',
		agentName: 'coder',
		kind: 'subagent' as const
	};
	expect(runConversationHref(base)).toBeUndefined();
	expect(runConversationHref(base, { ...base, kind: 'chat', turnId: 'older' })).toBe(
		'/chat?turn=older'
	);
	expect(runConversationHref({ ...base, conversationId: 'topic', turnId: 'turn-1' })).toBe(
		'/chats/topic?turn=turn-1'
	);
	expect(runConversationHref({ ...base, conversationId: 'task-t-login', turnId: 'turn-2' })).toBe(
		'/tasks/t-login?view=conversation&turn=turn-2'
	);
});

test('a run opens the reply it delivered, else its turn, and names what triggered it', () => {
	const chat = {
		runId: 'run',
		title: 'Hi',
		status: 'done' as const,
		startedAt: '2026-10-01',
		agentName: 'main',
		kind: 'chat' as const,
		turnId: 'turn-1'
	};
	expect(runResultHref(chat)).toBe('/chat?turn=turn-1');
	expect(
		runResultHref({ ...chat, result: { conversationId: 'task-t-login', message: 'outbox-12345' } })
	).toBe('/tasks/t-login?view=conversation&m=outbox-12345');
	expect(runResultHref({ ...chat, result: { conversationId: 'trip', message: 's-4' } })).toBe(
		'/chats/trip?m=s-4'
	);

	expect(runTrigger(chat)).toBeUndefined();
	expect(
		runTrigger({
			...chat,
			trigger: { type: 'message', conversationId: 'trip', message: '01K6B4A0C2E4G6J8M0P2R4T6V1' }
		})
	).toEqual({ label: 'Your message', href: '/chats/trip?m=01K6B4A0C2E4G6J8M0P2R4T6V1' });
	expect(
		runTrigger({ ...chat, kind: 'job', trigger: { type: 'schedule', jobName: 'nightly' } })
	).toEqual({ label: 'Schedule · nightly' });
	const sub = {
		...chat,
		kind: 'subagent' as const,
		trigger: { type: 'parent' as const, runId: 'P1' }
	};
	expect(runTrigger(sub)).toEqual({ label: 'Parent activity', href: '/runs/P1' });
	expect(
		runTrigger(sub, {
			runHref: (id) => `/x/${id}`,
			parent: { ...chat, runId: 'P1', kind: 'agent', title: 'Fix it' }
		})
	).toEqual({ label: 'Fix it', href: '/x/P1' });
});
