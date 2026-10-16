import { channelHref, type Channel } from '$lib/features/channels';
import type { TaskRecord } from '$lib/features/tasks';
import type { HomeGroups } from '$lib/features/home';
import type { ArtifactSummary } from '$lib/features/artifacts';

export interface ContinueItem {
	id: string;
	title: string;
	href: string;
	kind: 'chat' | 'document';
}

/** Only explicit visits belong in Continue; incoming activity does not imply a visit. */
export function continueItems(
	channels: Channel[],
	channelIds: string[],
	artifacts: ArtifactSummary[],
	artifactIds: string[]
): ContinueItem[] {
	const chats = channelIds.flatMap((id) => {
		const channel = channels.find((c) => c.id === id && c.state !== 'archived');
		return channel
			? [
					{
						id: `chat:${id}`,
						title: channel.title,
						href: channelHref(channel),
						kind: 'chat' as const
					}
				]
			: [];
	});
	const documents = artifactIds.flatMap((id) => {
		const document = artifacts.find((a) => a.id === id);
		return document
			? [
					{
						id: `document:${id}`,
						title: document.title,
						href: `/artifacts/${encodeURIComponent(id)}`,
						kind: 'document' as const
					}
				]
			: [];
	});
	return [...chats.slice(0, documents.length ? 1 : 2), ...documents.slice(0, chats.length ? 1 : 2)];
}

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
			(item) => item.kind !== 'run' || !representedRuns.has(item.run.runId)
		)
	};
}
