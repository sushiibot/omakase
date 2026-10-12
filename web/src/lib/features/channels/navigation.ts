import type { Channel, ChannelFilter, ChannelView } from './types';

export function channelHref(channel: Channel): string {
	if (channel.kind === 'main') return '/chat';
	if (channel.kind === 'task' && channel.taskId)
		return `/tasks/${encodeURIComponent(channel.taskId)}?view=conversation`;
	return `/chats/${encodeURIComponent(channel.id)}`;
}

/** Explicit visits only; background activity never reorders the navigator. */
export function selectChannels(
	channels: readonly Channel[],
	view: ChannelView,
	recentIds: readonly string[],
	{ search = '', includeArchived = false }: ChannelFilter = {}
): Channel[] {
	const query = search.trim().toLowerCase();
	const rank = new Map(recentIds.map((id, index) => [id, index]));
	return channels
		.filter((channel) => {
			if (channel.state === 'archived' && !includeArchived && !query) return false;
			if (view === 'needs-you' && channel.pending.total === 0) return false;
			return !query || `${channel.title}\n${channel.preview}`.toLowerCase().includes(query);
		})
		.sort((a, b) => {
			if (a.kind === 'main') return b.kind === 'main' ? 0 : -1;
			if (b.kind === 'main') return 1;
			if (view === 'recent') {
				const aRank = rank.get(a.id) ?? Infinity;
				const bRank = rank.get(b.id) ?? Infinity;
				if (aRank !== bRank) return aRank < bRank ? -1 : 1;
			}
			return (
				a.title.localeCompare(b.title, 'en', { sensitivity: 'base', numeric: true }) ||
				a.id.localeCompare(b.id)
			);
		});
}
