// Development/test only. Reads the same mutable fixture APIs as their existing screens.
import type { ChatApi } from '$lib/features/chat';
import type { TasksApi } from '$lib/features/tasks';
import type { ThreadsApi } from '$lib/features/threads';
import type { WebHistoryItem } from '$lib/core/realtime/events';
import type { ChannelsApi } from './api';
import type { Channel, ChannelCatalog } from './types';

function base(
	id: string,
	title: string,
	state: Channel['state'],
	lastActivity: string | null,
	preview: string
): Channel {
	const waiting = state === 'needs-you';
	return {
		id,
		title,
		kind: id === 'main' ? 'main' : 'channel',
		state,
		lastActivity,
		preview,
		pending: { asks: waiting ? 1 : 0, approvals: 0, total: waiting ? 1 : 0 },
		attention: waiting
			? [
					{
						kind: 'ask',
						id: `fixture-question:${id}`,
						seq: 0,
						at: lastActivity ?? new Date(0).toISOString()
					}
				]
			: [],
		activity: { running: state === 'running', turnCount: state === 'running' ? 1 : 0 },
		headSeq: 0,
		lastMessageSeq: null,
		unread: null
	};
}

function historyPending(
	history: readonly WebHistoryItem[]
): Pick<Channel, 'pending' | 'attention'> {
	const attention: Channel['attention'] = history.flatMap<Channel['attention'][number]>((item) => {
		if (item.type === 'ask' && item.askId && item.answer === undefined)
			return [{ kind: 'ask' as const, id: item.askId, seq: 0, at: item.at }];
		if (item.type === 'approval' && item.decision === null)
			return [{ kind: 'approval' as const, id: item.nonce, seq: 0, at: item.at }];
		return [];
	});
	const asks = attention.filter((item) => item.kind === 'ask').length;
	return {
		attention,
		pending: { asks, approvals: attention.length - asks, total: attention.length }
	};
}

export function createFixtureChannelsApi({
	threads,
	tasks,
	main
}: {
	threads: ThreadsApi;
	tasks: TasksApi;
	main?: Pick<ChatApi, 'history'>;
}): ChannelsApi {
	return {
		async list(): Promise<ChannelCatalog> {
			const [chats, taskData, mainHistory] = await Promise.all([
				threads.list(),
				tasks.list(),
				main?.history({ limit: 100 })
			]);
			const mainChannel = base(
				'main',
				chats.main.title ?? 'Main',
				chats.main.state,
				chats.main.lastActivity,
				chats.main.preview
			);
			if (mainHistory?.ok) {
				Object.assign(mainChannel, historyPending(mainHistory.page.items));
				if (mainChannel.pending.total) mainChannel.state = 'needs-you';
			}
			const channels: Channel[] = [
				mainChannel,
				...chats.threads.map((thread) => ({
					...base(thread.id, thread.title, thread.state, thread.lastActivity, thread.preview),
					...(thread.archived ? { archived: thread.archived } : {})
				}))
			];
			for (const task of taskData.tasks) {
				if (!task.workConversationId) continue;
				const state =
					task.status === 'needs-you'
						? 'needs-you'
						: task.status === 'in-progress'
							? 'running'
							: 'idle';
				const channel = {
					...base(
						task.workConversationId,
						task.title,
						state,
						task.updatedAt,
						task.result ?? task.brief
					),
					kind: 'task' as const,
					taskId: task.id
				};
				const index = channels.findIndex((existing) => existing.id === channel.id);
				if (index < 0) channels.push(channel);
				else channels[index] = channel;
			}
			return { channels, archiveAfterDays: chats.archiveAfterDays };
		}
	};
}
