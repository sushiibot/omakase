import { expect, test } from 'bun:test';
import { homeWork, continueItems } from './model';
import type { HomeGroups } from '$lib/features/home';
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
test('Continue uses chat visits and removes missing and archived records', () => {
	const channels = [
		channelFixture('a', 'Alpha'),
		channelFixture('b', 'Beta', { state: 'archived' }),
		channelFixture('c', 'Gamma'),
		channelFixture('d', 'Delta')
	];
	expect(continueItems(channels, [])).toEqual([]);
	expect(continueItems(channels, ['missing', 'b', 'a', 'c', 'd']).map((i) => i.href)).toEqual([
		'/chats/a',
		'/chats/c'
	]);
});
