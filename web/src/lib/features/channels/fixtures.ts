import type { Channel, ChannelCatalog } from './types';
export function channelFixture(id: string, title: string, patch: Partial<Channel> = {}): Channel {
	return {
		id,
		title,
		kind: id === 'main' ? 'main' : 'channel',
		state: 'idle',
		lastActivity: null,
		preview: '',
		pending: { asks: 0, approvals: 0, total: 0 },
		attention: [],
		activity: { running: false, turnCount: 0 },
		headSeq: 0,
		lastMessageSeq: null,
		unread: null,
		...patch
	};
}
export function channelCatalogFixture(): ChannelCatalog {
	return {
		archiveAfterDays: 7,
		channels: [
			channelFixture('main', 'Main'),
			channelFixture('deployment', 'Deployment', {
				state: 'needs-you',
				preview: 'Choose the deployment window.',
				pending: { asks: 1, approvals: 0, total: 1 },
				attention: [{ kind: 'ask', id: 'deployment-window', seq: 1, at: '2026-10-11T12:00:00Z' }]
			}),
			channelFixture('design', 'UI redesign', {
				state: 'running',
				activity: { running: true, turnCount: 1 }
			}),
			channelFixture('task-t-release', 'Release checklist', { kind: 'task', taskId: 't-release' }),
			channelFixture('travel', 'Travel planning'),
			channelFixture('old', 'Old planning', {
				state: 'archived',
				archived: { at: '2026-10-01T12:00:00Z', by: 'you' }
			})
		]
	};
}
