import { describe, expect, test } from 'bun:test';
import { activeNav, allOn, moreFor, navFor, workspaceFor } from './nav';

describe('workspace navigation', () => {
	test('live destinations stay available while optional tools remain inside Workspace', () => {
		const liveOnly = () => false;
		expect(navFor(liveOnly).map((entry) => entry.href)).toEqual([
			'/assistant',
			'/chats',
			'/tasks',
			'/runs',
			'/workspace',
			'/settings'
		]);
		expect(workspaceFor(liveOnly).map((entry) => entry.href)).toEqual([
			'/artifacts',
			'/memory',
			'/history',
			'/workspace/agent-settings'
		]);
		expect(
			workspaceFor(allOn)
				.filter((entry) => entry.feature)
				.map((entry) => entry.feature)
		).toEqual(['briefing', 'skills', 'schedules', 'browser']);
		expect(navFor(allOn).map((entry) => entry.href)).toEqual(
			navFor(liveOnly).map((entry) => entry.href)
		);
	});
	test('deep links belong to their global destination while Main belongs to channels', () => {
		for (const route of ['/chat', '/inbox', '/chats/[id]']) expect(activeNav(route)).toBe('chats');
		for (const route of [
			'/memory/[file]/diff',
			'/history/[day]',
			'/connectors/[name]',
			'/settings/mail',
			'/settings/permissions',
			'/workspace/agent-settings',
			'/file-stores',
			'/skills/[name]/versions',
			'/more',
			'/workspace',
			'/(owner)/browser'
		])
			expect(activeNav(route)).toBe('workspace');
		expect(activeNav('/assistant')).toBe('assistant');
		expect(activeNav('/tasks/[id]')).toBe('tasks');
		expect(activeNav('/runs/[id]')).toBe('runs');
		expect(activeNav('/settings')).toBe('settings');
		expect(activeNav(null)).toBeUndefined();
		expect(activeNav('/unknown')).toBeUndefined();
	});
	test('legacy More enumeration keeps existing deep routes and preview filtering', () => {
		expect(moreFor((feature) => feature === 'skills').map((entry) => entry.id)).toContain('skills');
		expect(moreFor((feature) => feature === 'skills').map((entry) => entry.id)).not.toContain(
			'schedules'
		);
		expect(moreFor(() => false).map((entry) => entry.id)).toContain('connectors');
	});
});
