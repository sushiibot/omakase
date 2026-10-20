<script lang="ts">
	import type { Snippet } from 'svelte';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Check from '@lucide/svelte/icons/check';
	import { Button } from '$lib/ui/button';
	import Section from '$lib/ui/section/section.svelte';
	import TabbedScreen from '$lib/ui/screen/tabbed-screen.svelte';
	import { Skeleton } from '$lib/ui/skeleton';
	import { HomeRow, type HomeGroups } from '$lib/features/home';
	import type { TaskRecord } from '$lib/features/tasks';
	import type { Channel } from '$lib/features/channels';
	import { channelHref } from '$lib/features/channels';
	import { ago } from '$lib/ui/format/time';
	import { homeWork, type ContinueItem } from './model';

	let {
		tab = $bindable('overview'),
		groups,
		tasks,
		recent,
		channels,
		now,
		selected,
		notices = [],
		loading = false,
		onopen,
		banner,
		toast,
		maintenanceCount = 0,
		maintenanceAttention,
		maintenanceUpdates,
		maintenanceWatching,
		inUse,
		inUseCount = 0
	}: {
		tab?: string;
		groups: HomeGroups;
		tasks: TaskRecord[];
		recent: ContinueItem[];
		channels: Channel[];
		now: number;
		selected?: string;
		notices?: { label: string; retry: () => void }[];
		loading?: boolean;
		onopen: (id: string) => void;
		banner?: Snippet;
		toast?: Snippet;
		maintenanceCount?: number;
		maintenanceAttention?: Snippet;
		maintenanceUpdates?: Snippet;
		maintenanceWatching?: Snippet;
		/** Saved items in use (pinned, running timers, open checklists), after Needs you. */
		inUse?: Snippet;
		inUseCount?: number;
	} = $props();
	const work = $derived(homeWork(tasks, groups));
	const channelWaiting = $derived(channels.filter((c) => c.kind !== 'main' && c.pending.total > 0));
	const taskWaiting = $derived(
		work.waiting.filter((t) => !channelWaiting.some((c) => c.taskId === t.id))
	);
	const attention = $derived([...groups.waiting, ...groups.failed]);
	const attentionCount = $derived(attention.length + channelWaiting.length + taskWaiting.length);
	const running = $derived(work.running);
	const noWork = $derived(
		!attentionCount &&
			!inUseCount &&
			!recent.length &&
			!groups.review.length &&
			!running.length &&
			!work.runs.length
	);
	const tabs = [
		{ value: 'overview', label: 'Overview' },
		{ value: 'following', label: 'Tasks' },
		{ value: 'watching', label: 'Watching' },
		{ value: 'history', label: 'History' }
	];
</script>

{#snippet taskRow(task: TaskRecord)}
	<Button
		href={`/tasks/${encodeURIComponent(task.id)}`}
		variant="ghost"
		class="h-auto w-full justify-start gap-3 px-2 py-3 text-left whitespace-normal"
	>
		{#if task.status === 'done'}<Check class="shrink-0 text-review" />{:else}<span
				class="size-2 shrink-0 rounded-full bg-current"
				class:text-running={task.status === 'in-progress'}
				class:text-muted-foreground={task.status !== 'in-progress'}
			></span>{/if}
		<span class="min-w-0 flex-1"
			><span class="block text-sm font-medium [overflow-wrap:anywhere]">{task.title}</span><span
				class="mt-1 block text-xs font-normal text-muted-foreground"
				>{task.status === 'in-progress'
					? 'In progress'
					: task.status === 'needs-you'
						? 'Waiting for you'
						: task.status === 'done'
							? 'Completed'
							: task.status === 'cancelled'
								? 'Cancelled'
								: 'To do'} · {ago(task.updatedAt, now)}</span
			></span
		>
		<ChevronRight class="shrink-0 text-muted-foreground" />
	</Button>
{/snippet}

<TabbedScreen
	title="Home"
	label="Home views"
	{tabs}
	bind:value={tab}
	{banner}
	{toast}
	measure="reading"
>
	{#snippet children(view)}
		<div class="flex flex-col gap-7" data-assistant-home>
			{#if loading}<div role="status" class="space-y-3">
					<span class="sr-only">Loading Home…</span><Skeleton class="h-5 w-28" /><Skeleton
						class="h-24 w-full"
					/>
				</div>{/if}
			{#if view === 'overview'}
				{@render maintenanceAttention?.()}
				{#if attentionCount}
					<Section title="Needs you" count={attentionCount}>
						<div class="space-y-2">
							{#each attention as item (item.id)}
								<div class="rounded-xl border p-2">
									<HomeRow dialog={false} {item} {now} selected={selected === item.id} {onopen} />
									<div class="flex justify-end px-2">
										<Button variant="outline" onclick={() => onopen(item.id)}>Review</Button>
									</div>
								</div>
							{/each}
							{#each channelWaiting as channel (channel.id)}
								<Button
									href={channelHref(channel)}
									variant="outline"
									class="h-auto w-full justify-between gap-3 py-3 whitespace-normal"
									><span class="min-w-0 text-left [overflow-wrap:anywhere]"
										>{channel.title}<span class="block text-xs font-normal text-muted-foreground"
											>{channel.pending.total} waiting for you</span
										></span
									><ChevronRight class="shrink-0" /></Button
								>
							{/each}
							{#each taskWaiting as task (task.id)}{@render taskRow(task)}{/each}
						</div>
					</Section>
				{:else if !loading && !notices.length && !maintenanceCount}
					<p class="flex items-center gap-2 text-sm text-muted-foreground">
						<Check class="size-4" />Nothing needs your attention.
					</p>
				{/if}
				{@render inUse?.()}
				{@render maintenanceUpdates?.()}
				{#if recent.length}
					<Section title="Continue">
						<div class="grid gap-2 sm:grid-cols-2">
							{#each recent as item (item.id)}
								<Button
									href={item.href}
									variant="outline"
									class="h-auto justify-start gap-3 py-3 text-left whitespace-normal"
								>
									<MessageSquare class="shrink-0" />
									<span class="line-clamp-2 min-w-0 flex-1 [overflow-wrap:anywhere]"
										>{item.title}</span
									><ChevronRight class="shrink-0 text-muted-foreground" />
								</Button>
							{/each}
						</div>
					</Section>
				{/if}
				{#if groups.review.length}
					<Section title="Ready for you">
						<div class="divide-y rounded-xl border px-2">
							{#each groups.review.slice(0, 4) as item (item.id)}<HomeRow
									dialog={false}
									{item}
									{now}
									selected={selected === item.id}
									{onopen}
								/>{/each}
						</div>
						{#if groups.review.length > 4}<Button href="/chats" variant="ghost"
								>All inbox updates ({groups.review.length})</Button
							>{/if}
					</Section>
				{/if}
				{#if running.length || work.runs.length}
					<Section title="In progress" count={running.length + work.runs.length}>
						{#each running as task (task.id)}{@render taskRow(task)}{/each}
						{#each work.runs as item (item.id)}<HomeRow
								dialog={false}
								{item}
								{now}
								selected={selected === item.id}
								{onopen}
							/>{/each}
					</Section>
				{/if}
				{#if noWork && !loading && !notices.length}
					<Section
						title="A place to pick up where you left off"
						description="Your recent conversations and the agent’s work will appear here."
						><div><Button href="/chat"><MessageSquare />Start a conversation</Button></div></Section
					>
				{/if}
			{:else if view === 'watching'}
				{@render maintenanceWatching?.()}
			{:else if view === 'following'}
				<Section
					title="Your ongoing work"
					description="Tasks you have saved or delegated. Open a task to review its plan or continue the conversation."
				>
					{#snippet aside()}<Button href="/tasks" variant="ghost">All tasks</Button>{/snippet}
					{#each work.following as task (task.id)}{@render taskRow(task)}{:else}{#if !loading}<p
								class="py-4 text-sm text-muted-foreground"
							>
								No ongoing tasks. Add one in Tasks or ask the agent to work on something.
							</p>{/if}{/each}
				</Section>
			{:else}
				<Section
					title="Finished work"
					description="Completed and cancelled tasks. Activity holds the full execution history."
				>
					{#snippet aside()}<Button href="/runs" variant="ghost">Open Activity</Button>{/snippet}
					{#each work.history as task (task.id)}{@render taskRow(task)}{:else}{#if !loading}<p
								class="py-4 text-sm text-muted-foreground"
							>
								No finished tasks yet.
							</p>{/if}{/each}
				</Section>
			{/if}
			{#each notices as notice (notice.label)}<div
					role="alert"
					class="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3"
				>
					<p class="text-sm text-muted-foreground">{notice.label}</p>
					<Button variant="outline" onclick={notice.retry}>Try again</Button>
				</div>{/each}
		</div>
	{/snippet}
</TabbedScreen>
