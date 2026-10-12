/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { activityTitle, filterKinds, kindLabel, runConversationHref } from './format';

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
