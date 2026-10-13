<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Search from '@lucide/svelte/icons/search';
	import { Button } from '$lib/ui/button';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import { dayLabel, fromDate } from '$lib/ui/format/time';
	import * as Item from '$lib/ui/item';
	import { PageIntro } from '$lib/ui/page';
	import ListScreen, { type ListSection } from '$lib/ui/screen/list-screen.svelte';
	import type { RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import { Skeleton } from '$lib/ui/skeleton';
	import { Spinner } from '$lib/ui/spinner';
	import type { HistoryDay } from './types';
	import { costLabel, costDescription } from './cost';

	let {
		remote,
		days,
		now,
		back,
		hasOlder = false,
		olderLoading = false,
		olderError = null,
		online = true,
		dayHref = (date) => `/history/${date}`,
		searchHref = '/history/search',
		memoryHref,
		onretry,
		onloadolder
	}: {
		remote: RemoteLike;
		days: HistoryDay[];
		now: number;
		back?: { href: string; label: string; onclick?: (e: MouseEvent) => void };
		hasOlder?: boolean;
		olderLoading?: boolean;
		olderError?: string | null;
		online?: boolean;
		dayHref?: (date: string) => string;
		searchHref?: string;
		memoryHref?: string;
		onretry?: () => void;
		onloadolder?: () => void;
	} = $props();

	const sections = $derived.by(() => {
		const months = new Map<string, HistoryDay[]>();
		for (const day of days) {
			const key = day.date.slice(0, 7);
			months.set(key, [...(months.get(key) ?? []), day]);
		}
		return [...months.entries()].map(([key, items]): ListSection<HistoryDay> => ({
			label: new Date(fromDate(`${key}-01`)).toLocaleDateString(undefined, {
				month: 'long',
				year: 'numeric'
			}),
			items
		}));
	});
	const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
</script>

{#snippet banner()}
	{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}
{/snippet}

{#snippet lead()}
	<PageIntro
		description="Work history by day: the agent’s written recaps and the activity behind them."
	/>
	{#if memoryHref}
		<Button variant="outline" href={memoryHref} class="self-start">View saved memory</Button>
		<p class="text-sm text-muted-foreground">Saved facts and daily memory notes are in Memory.</p>
	{/if}
	<Button
		variant="outline"
		href={searchHref}
		class="justify-start border-input font-normal text-muted-foreground"
	>
		<Search aria-hidden="true" />Search chat and notes
	</Button>
{/snippet}

{#snippet skeleton()}
	<div class="flex flex-col gap-2" aria-hidden="true">
		<Skeleton class="h-4 w-28" />
		{#each [0, 1, 2, 3, 4] as i (i)}
			<div class="flex flex-col gap-2 px-3 py-2.5">
				<Skeleton class="h-4 w-1/3" />
				<Skeleton class="h-3 w-1/2" />
			</div>
		{/each}
	</div>
	<p role="status" class="sr-only">Loading history…</p>
{/snippet}

{#snippet row(day: HistoryDay)}
	<Item.Root size="sm">
		{#snippet child({ props })}
			<a href={dayHref(day.date)} {...props}>
				<Item.Content class="min-w-0">
					<Item.Title>{dayLabel(fromDate(day.date), now)}</Item.Title>
					<Item.Description>
						{day.sessions || day.runs
							? [
									day.sessions && count(day.sessions, 'recap', 'recaps'),
									day.runs && count(day.runs, 'execution', 'executions')
								]
									.filter(Boolean)
									.join(' · ')
							: 'Nothing recorded'}
						{#if day.runs}
							<span title={costDescription(day.cost)}> · {costLabel(day.cost)}</span>
						{/if}
					</Item.Description>
				</Item.Content>
				<Item.Actions>
					<ChevronRight class="size-4 text-muted-foreground" aria-hidden="true" />
				</Item.Actions>
			</a>
		{/snippet}
	</Item.Root>
{/snippet}

{#snippet after()}
	{#if days.length && remote.status === 'error'}
		<div role="alert" class="flex flex-col items-start gap-2">
			<p class="text-sm text-failed">Couldn't refresh history. {remote.error}</p>
			<Button variant="outline" onclick={onretry}>Retry refresh</Button>
		</div>
	{/if}
	{#if hasOlder}
		<Button variant="outline" disabled={olderLoading} onclick={() => onloadolder?.()}>
			{#if olderLoading}
				<Spinner class="motion-reduce:animate-none" aria-hidden="true" />Loading older days…
			{:else}
				<ChevronDown />Show older days
			{/if}
		</Button>
		{#if olderError}
			<p role="alert" class="text-sm text-failed">Couldn't load older days. {olderError}</p>
		{/if}
	{/if}
{/snippet}

<ListScreen
	title="History"
	{back}
	{banner}
	{lead}
	state={{
		remote:
			days.length && (remote.status === 'loading' || remote.status === 'error')
				? { status: 'ready' }
				: remote,
		offline: !online,
		errorTitle: "Couldn't load history.",
		onretry,
		skeleton,
		empty: {
			title: 'No notes yet',
			body: 'The agent writes a note for each day it works. They show up here, newest first.'
		}
	}}
	{sections}
	key={(d) => d.date}
	{row}
	{after}
/>
