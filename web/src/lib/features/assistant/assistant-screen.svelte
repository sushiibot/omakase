<script lang="ts">
	import type { Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import Check from '@lucide/svelte/icons/check';
	import Hash from '@lucide/svelte/icons/hash';
	import ListTodo from '@lucide/svelte/icons/list-todo';
	import MessageCircleQuestion from '@lucide/svelte/icons/message-circle-question';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Hand from '@lucide/svelte/icons/hand';
	import { Button } from '$lib/ui/button';
	import { MOBILE_BREAKPOINT } from '$lib/ui/breakpoints';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import Section from '$lib/ui/section/section.svelte';
	import { Skeleton } from '$lib/ui/skeleton';
	import { ago } from '$lib/ui/format/time';
	import { Composer } from '$lib/features/chat';
	import { HomeLinkRow, HomeRow, type HomeGroups } from '$lib/features/home';
	import type { TaskRecord } from '$lib/features/tasks';
	import type { Channel } from '$lib/features/channels';
	import {
		greeting,
		homeWork,
		mainTitle,
		needsYouList,
		summaryLine,
		workingNow,
		type RecentConversation
	} from './model';

	/** Rows shown before Working now and Ready for you collapse. */
	const WORK_SHOWN = 3;
	const READY_SHOWN = 5;
	const FINISHED_SHOWN = 3;

	let {
		ask = $bindable(''),
		groups,
		tasks,
		recent,
		channels,
		now,
		selected,
		notices = [],
		loading = false,
		onopen,
		onask,
		banner,
		toast,
		maintenanceCount = 0,
		maintenanceAttention,
		maintenanceUpdates,
		maintenanceWatching,
		inUse,
		inUseCount = 0
	}: {
		/** The quick-ask draft for Main. */
		ask?: string;
		groups: HomeGroups;
		tasks: TaskRecord[];
		recent: RecentConversation[];
		channels: Channel[];
		now: number;
		selected?: string;
		notices?: { label: string; retry: () => void }[];
		loading?: boolean;
		onopen: (id: string) => void;
		/** Sends the quick ask to Main. */
		onask: () => void;
		banner?: Snippet;
		toast?: Snippet;
		maintenanceCount?: number;
		maintenanceAttention?: Snippet;
		maintenanceUpdates?: Snippet;
		maintenanceWatching?: Snippet;
		/** Saved items in use (pinned, running timers, open checklists), after Working now. */
		inUse?: Snippet;
		inUseCount?: number;
	} = $props();

	// The quick ask sits under the status line on desktop and within thumb reach on phones.
	const desktop = new MediaQuery(`(min-width: ${MOBILE_BREAKPOINT}px)`);
	const work = $derived(homeWork(tasks, groups));
	const needs = $derived(needsYouList(groups, channels, tasks));
	const working = $derived(workingNow(groups, channels, tasks));
	const main = $derived(mainTitle(channels));
	let allWork = $state(false);
	const shownWork = $derived(allWork ? working : working.slice(0, WORK_SHOWN));
	const hasNeeds = $derived(
		needs.requests.length + needs.channels.length + needs.tasks.length + needs.failed.length > 0
	);
	const quiet = $derived(
		!hasNeeds && !working.length && !inUseCount && !maintenanceCount && !loading && !notices.length
	);
	const finished = $derived(work.history.slice(0, FINISHED_SHOWN));
	const summary = $derived(
		summaryLine({
			need: needs.count,
			failed: needs.failed.length,
			running: working.length,
			ready: groups.review.length
		})
	);
</script>

{#snippet askBox()}
	<Composer
		bind:value={ask}
		label="Ask {main}"
		sendLabel="Send to {main}"
		placeholder="Ask anything"
		attach={false}
		stop={false}
		onsend={onask}
	/>
{/snippet}

{#snippet footer()}<div class="border-t" data-home-ask>{@render askBox()}</div>{/snippet}

<DetailScreen
	title="Home"
	{banner}
	{toast}
	footer={desktop.current ? undefined : footer}
	measure="reading"
>
	<ScreenContent>
		<div class="flex flex-col gap-7" data-assistant-home>
			<div class="flex flex-col gap-0.5" data-home-status>
				<p class="text-base font-medium">{greeting(now)}</p>
				{#if !loading}<p class="flex items-center gap-1.5 text-sm text-muted-foreground">
						{#if quiet}<Check class="size-4 shrink-0" aria-hidden="true" />{/if}{summary}
					</p>{/if}
			</div>
			{#if desktop.current}<div class="-mx-4 -mt-4" data-home-ask>{@render askBox()}</div>{/if}
			<!-- First load only: a placeholder above rows that already arrived would push them down. -->
			{#if loading && !hasNeeds && !working.length && !groups.review.length && !recent.length}<div
					role="status"
					class="space-y-3"
				>
					<span class="sr-only">Loading Home…</span><Skeleton class="h-5 w-28" /><Skeleton
						class="h-24 w-full"
					/>
				</div>{/if}
			{@render maintenanceAttention?.()}
			{#if hasNeeds}
				<Section title="Needs you">
					<div class="divide-y rounded-xl border px-2" data-home-needs>
						{#each needs.requests as request (request.item.id)}<HomeRow
								dialog={false}
								item={request.item}
								context={request.context}
								{now}
								selected={selected === request.item.id}
								{onopen}
							/>{/each}
						{#each needs.channels as row (row.channel.id)}<HomeLinkRow
								href={row.href}
								tone="waiting"
								icon={row.kind === 'ask' ? MessageCircleQuestion : Hand}
								iconLabel={row.kind === 'ask' ? 'Question' : 'Approval'}
								title="{row.ids.length > 1
									? `${row.ids.length} requests waiting`
									: row.kind === 'ask'
										? 'Question waiting'
										: 'Approval waiting'} · {row.channel.title}"
								sub={row.channel.preview || undefined}
								when={ago(row.at, now)}
							/>{/each}
						{#each needs.tasks as task (task.id)}<HomeLinkRow
								href="/tasks/{encodeURIComponent(task.id)}"
								tone="waiting"
								icon={ListTodo}
								iconLabel="Task"
								title={task.title}
								sub={task.result ?? 'Task waiting for you'}
								when={ago(task.updatedAt, now)}
							/>{/each}
						{#each needs.failed as item (item.id)}<HomeRow
								dialog={false}
								{item}
								{now}
								selected={selected === item.id}
								{onopen}
							/>{/each}
					</div>
				</Section>
			{/if}
			{#if working.length}
				<Section title="Working now">
					{#snippet aside()}<Button href="/tasks" variant="ghost">All tasks</Button>{/snippet}
					<div class="divide-y rounded-xl border px-2" data-home-working>
						{#each shownWork as row (row.id)}
							{#if row.kind === 'item'}<HomeRow
									dialog={false}
									item={row.item}
									{now}
									selected={selected === row.item.id}
									{onopen}
								/>{:else}<HomeLinkRow
									href={row.href}
									tone="running"
									spinning
									title={row.title}
									sub={row.step}
									when={row.at ? ago(row.at, now) : undefined}
								/>{/if}
						{/each}
					</div>
					{#if working.length > WORK_SHOWN}<div>
							<Button variant="ghost" aria-expanded={allWork} onclick={() => (allWork = !allWork)}
								>{allWork ? 'Show less' : `Show ${working.length - WORK_SHOWN} more`}</Button
							>
						</div>{/if}
				</Section>
			{/if}
			{@render inUse?.()}
			{#if recent.length}
				<Section title="Recent conversations">
					<div class="divide-y rounded-xl border px-2" data-home-recent>
						{#each recent as item (item.id)}<HomeLinkRow
								href={item.href}
								icon={item.kind === 'main' ? MessageSquare : item.kind === 'task' ? ListTodo : Hash}
								title={item.title}
								sub={item.preview || undefined}
								when={item.at ? ago(item.at, now) : undefined}
								unread={item.unread}
							/>{/each}
					</div>
				</Section>
			{/if}
			{@render maintenanceUpdates?.()}
			{#if groups.review.length}
				<Section title="Ready for you">
					<div class="divide-y rounded-xl border px-2" data-home-ready>
						{#each groups.review.slice(0, READY_SHOWN) as item (item.id)}<HomeRow
								dialog={false}
								preview
								{item}
								{now}
								selected={selected === item.id}
								{onopen}
							/>{/each}
					</div>
					{#if groups.review.length > READY_SHOWN}<div>
							<Button href="/chats" variant="ghost">All updates ({groups.review.length})</Button>
						</div>{/if}
				</Section>
			{/if}
			{#if quiet && finished.length}
				<Section title="Recently finished">
					{#snippet aside()}<Button href="/runs" variant="ghost">Open Activity</Button>{/snippet}
					<div class="divide-y rounded-xl border px-2" data-home-finished>
						{#each finished as task (task.id)}<HomeLinkRow
								href="/tasks/{encodeURIComponent(task.id)}"
								tone="review"
								icon={Check}
								muted
								title={task.title}
								sub={task.status === 'done' ? 'Completed' : 'Cancelled'}
								when={ago(task.updatedAt, now)}
							/>{/each}
					</div>
				</Section>
			{:else if quiet && !recent.length && !groups.review.length}
				<p class="text-sm text-muted-foreground">
					Your recent conversations and the agent’s work will appear here.
				</p>
			{/if}
			{@render maintenanceWatching?.()}
			{#each notices as notice (notice.label)}<div
					role="alert"
					class="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3"
				>
					<p class="text-sm text-muted-foreground">{notice.label}</p>
					<Button variant="outline" onclick={notice.retry}>Try again</Button>
				</div>{/each}
		</div>
	</ScreenContent>
</DetailScreen>
