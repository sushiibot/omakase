import { conversationHref } from '$lib/core/nav/conversation';
import { channelHref, type Channel } from '$lib/features/channels';
import type { TaskRecord } from '$lib/features/tasks';
import type { HomeGroups, HomeItem } from '$lib/features/home';

/** Group by persisted task/run identities. Similar titles are not evidence of shared work. */
export function homeWork(tasks: TaskRecord[], groups: HomeGroups) {
	const sorted = [...tasks].sort(
		(a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
	);
	const live = sorted.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
	const running = live.filter((t) => t.status === 'in-progress');
	const representedRuns = new Set(running.flatMap((t) => t.runIds));
	return {
		following: live,
		waiting: live.filter((t) => t.status === 'needs-you'),
		running,
		history: sorted.filter((t) => t.status === 'done' || t.status === 'cancelled'),
		runs: groups.running.filter(
			(item) => item.kind === 'run' && !representedRuns.has(item.run.runId)
		)
	};
}

/** How long a finished or cancelled task stays in Home's Recently finished. */
export const FINISHED_WINDOW_MS = 7 * 86_400_000;

/** Closed tasks from the last week, newest first; older ones live in Tasks. */
export function recentlyFinished(history: TaskRecord[], now: number, max: number): TaskRecord[] {
	return history.filter((t) => now - Date.parse(t.updatedAt) < FINISHED_WINDOW_MS).slice(0, max);
}

/** A conversation that holds requests Home has no record of, such as a topic's question. */
export interface ChannelRequests {
	channel: Channel;
	/** Request ids, as Home item ids (`ask:<id>`, `approval:<nonce>`), oldest first. */
	ids: string[];
	kind: 'ask' | 'approval';
	at: string;
	/** Lands on the oldest request in its conversation. */
	href: string;
}

export interface NeedsYouList {
	/** Approvals, questions and sign-in Home can review, oldest first, named by their conversation. */
	requests: { item: HomeItem; context?: string }[];
	channels: ChannelRequests[];
	/** Tasks marked as waiting for you with no request open in their conversation. */
	tasks: TaskRecord[];
	failed: HomeItem[];
	/**
	 * What needs you: each pending request id once (approvals and questions in every conversation),
	 * sign-in, and each waiting task without a request. Failed work is counted separately. The menu
	 * badge shows this number.
	 */
	count: number;
}

const taskChannel = (channel: Channel, task: TaskRecord) =>
	channel.id === task.workConversationId || (channel.kind === 'task' && channel.taskId === task.id);

/** One list for everything waiting on you, with one count both Home and the menu badge use. */
export function needsYouList(
	groups: HomeGroups,
	channels: Channel[],
	tasks: TaskRecord[]
): NeedsYouList {
	const known = new Set(groups.waiting.map((item) => item.id));
	const owner = new Map<string, Channel>();
	for (const channel of channels)
		for (const a of channel.attention) owner.set(`${a.kind}:${a.id}`, channel);
	const titled = (id?: string) => {
		const channel = id ? channels.find((c) => c.id === id) : undefined;
		return channel && channel.kind !== 'main' ? channel.title : undefined;
	};
	const requests = groups.waiting.map((item) => {
		const from = owner.get(item.id);
		const context = from
			? from.kind === 'main'
				? undefined
				: from.title
			: item.kind === 'approval'
				? titled(item.approval.view.conversationId)
				: undefined;
		return context ? { item, context } : { item };
	});
	const channelRows = channels.flatMap((channel): ChannelRequests[] => {
		const open = [...channel.attention]
			.sort((a, b) => a.seq - b.seq)
			.filter((a) => !known.has(`${a.kind}:${a.id}`));
		const first = open[0];
		if (!first) return [];
		const base = conversationHref(channel.id);
		const param = first.kind === 'ask' ? 'ask' : 'approve';
		return [
			{
				channel,
				ids: open.map((a) => `${a.kind}:${a.id}`),
				kind: first.kind,
				at: first.at,
				href: `${base}${base.includes('?') ? '&' : '?'}${param}=${encodeURIComponent(first.id)}`
			}
		];
	});
	const waitingTasks = homeWork(tasks, groups).waiting.filter(
		(task) => !channels.some((c) => taskChannel(c, task) && c.attention.length > 0)
	);
	const ids = new Set([...known, ...channelRows.flatMap((row) => row.ids)]);
	return {
		requests,
		channels: channelRows,
		tasks: waitingTasks,
		failed: groups.failed,
		count: ids.size + waitingTasks.length
	};
}

/** The number on the menu badge and Home's status line. */
export function needsYouCount(groups: HomeGroups, channels: Channel[], tasks: TaskRecord[]) {
	return needsYouList(groups, channels, tasks).count;
}

/** One row of Working now: a link to the work, or a run Home can review. */
export type WorkRow =
	| { id: string; kind: 'link'; title: string; step: string; at?: string; href: string }
	| { id: string; kind: 'item'; item: HomeItem };

export function mainTitle(channels: Channel[]): string {
	return channels.find((c) => c.kind === 'main')?.title ?? 'Main';
}

/** Live work: Main's turns with their step, running conversations, running tasks and runs. */
export function workingNow(
	groups: HomeGroups,
	channels: Channel[],
	tasks: TaskRecord[]
): WorkRow[] {
	const work = homeWork(tasks, groups);
	const main = mainTitle(channels);
	const turns = groups.running.flatMap((item): WorkRow[] =>
		item.kind === 'turn'
			? [
					{
						id: item.id,
						kind: 'link',
						title: main,
						step: item.turn.step ? `Working: ${item.turn.step}` : 'Writing a reply',
						at: item.at,
						href: conversationHref('main', { turn: item.turn.turnId })
					}
				]
			: []
	);
	const conversations = channels.flatMap((channel): WorkRow[] => {
		if (!channel.activity.running || channel.state === 'archived') return [];
		if (channel.kind === 'main' && turns.length) return [];
		if (work.running.some((task) => taskChannel(channel, task))) return [];
		return [
			{
				id: `chat:${channel.id}`,
				kind: 'link',
				title: channel.title,
				step:
					channel.activity.turnCount > 1
						? `Working on ${channel.activity.turnCount} replies`
						: 'Writing a reply',
				...(channel.lastActivity ? { at: channel.lastActivity } : {}),
				href: channelHref(channel)
			}
		];
	});
	const running = work.running.map((task): WorkRow => ({
		id: `task:${task.id}`,
		kind: 'link',
		title: task.title,
		step: task.agent ? `Task in progress · ${task.agent}` : 'Task in progress',
		at: task.updatedAt,
		href: `/tasks/${encodeURIComponent(task.id)}`
	}));
	const runs = work.runs.map((item): WorkRow => ({ id: item.id, kind: 'item', item }));
	return [...turns, ...conversations, ...running, ...runs];
}

export interface RecentConversation {
	id: string;
	title: string;
	preview: string;
	at: string | null;
	href: string;
	kind: Channel['kind'];
	unread: boolean;
}

/** Only explicit visits belong here; incoming activity does not imply a visit. */
export function recentConversations(
	channels: Channel[],
	visits: string[],
	limit = 4
): RecentConversation[] {
	return visits
		.flatMap((id): RecentConversation[] => {
			const channel = channels.find((c) => c.id === id && c.state !== 'archived');
			return channel
				? [
						{
							id: `chat:${id}`,
							title: channel.title,
							preview: channel.preview,
							at: channel.lastActivity,
							href: channelHref(channel),
							kind: channel.kind,
							unread: channel.hasNewMessages ?? false
						}
					]
				: [];
		})
		.slice(0, limit);
}

/** The status line's greeting, by the device's local time. */
export function greeting(now: number): string {
	const hour = new Date(now).getHours();
	if (hour >= 5 && hour < 12) return 'Good morning';
	if (hour >= 12 && hour < 18) return 'Good afternoon';
	return 'Good evening';
}

/** The status line's counts, leaving out what is zero. */
export function summaryLine(counts: {
	need: number;
	failed: number;
	running: number;
	ready: number;
}): string {
	const parts = [
		counts.need ? `${counts.need} need${counts.need === 1 ? 's' : ''} you` : null,
		counts.failed ? `${counts.failed} failed` : null,
		counts.running ? `${counts.running} running` : null,
		counts.ready ? `${counts.ready} ready` : null
	].filter((p): p is string => p !== null);
	if (!counts.need && !counts.failed)
		parts.unshift(counts.running ? 'Nothing needs you' : 'All clear');
	return parts.join(' · ');
}
