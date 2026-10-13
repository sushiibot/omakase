<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import ThumbsDown from '@lucide/svelte/icons/thumbs-down';
	import ThumbsUp from '@lucide/svelte/icons/thumbs-up';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/ui/button';
	import * as Card from '$lib/ui/card';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import { clock, longDate } from '$lib/ui/format/time';
	import { PageIntro } from '$lib/ui/page';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import type { RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import Section from '$lib/ui/section/section.svelte';
	import { Skeleton } from '$lib/ui/skeleton';
	import { cn } from '$lib/utils';
	import type { BriefItem, BriefVote, Briefing } from './types';

	let {
		remote,
		briefing,
		now,
		back,
		online = true,
		error = null,
		onvote,
		ondismiss,
		onretry
	}: {
		remote: RemoteLike;
		/** null: no briefing yet today. */
		briefing?: Briefing | null;
		now: number;
		back?: { href: string; label: string; onclick?: (e: MouseEvent) => void };
		online?: boolean;
		error?: string | null;
		onvote?: (id: string, vote: BriefVote) => void;
		ondismiss?: (id: string, dismissed: boolean) => void;
		onretry?: () => void;
	} = $props();

	const sections = $derived(
		(
			[
				['top', 'Top of mind'],
				['ahead', 'Looking ahead']
			] as const
		).map(([id, label]) => ({
			id,
			label,
			items: (briefing?.items ?? []).filter((i) => i.section === id)
		}))
	);
	const open = $derived((briefing?.items ?? []).filter((i) => !i.dismissed).length);
	const rated = $derived((briefing?.items ?? []).filter((i) => i.vote).length);
</script>

{#snippet banner()}
	{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}
{/snippet}

{#snippet skeleton()}
	<div class="flex flex-col gap-3 p-4 md:p-6" aria-hidden="true">
		<Skeleton class="h-6 w-1/2" />
		{#each [0, 1, 2] as i (i)}<Skeleton class="h-28 w-full rounded-xl" />{/each}
	</div>
	<p role="status" class="sr-only">Loading the briefing…</p>
{/snippet}

{#snippet item(i: BriefItem)}
	<li>
		<Card.Root
			size="sm"
			class={cn(i.dismissed && 'border border-dashed bg-transparent py-1 ring-0')}
		>
			{#if i.dismissed}
				<Card.Content class="flex items-center gap-2 pr-1 text-muted-foreground">
					<span class="min-w-0 flex-1 truncate">Dismissed: {i.title}</span>
					<Button variant="ghost" onclick={() => ondismiss?.(i.id, false)}><Undo2 />Undo</Button>
				</Card.Content>
			{:else}
				<Card.Header>
					<Card.Title class="[overflow-wrap:anywhere]">{i.title}</Card.Title>
					<Card.Description class="[overflow-wrap:anywhere]">{i.detail}</Card.Description>
				</Card.Header>
				<Card.Content>
					{#if i.source.href}
						<Button
							variant="link"
							href={i.source.href}
							class="h-auto min-h-8 px-0 text-left [overflow-wrap:anywhere] whitespace-normal text-brand"
							>{i.source.label}<ArrowUpRight aria-hidden="true" /></Button
						>
					{:else}
						<p class="text-xs text-muted-foreground">Source: {i.source.label}</p>
					{/if}
				</Card.Content>
				<Card.Content class="flex items-center gap-2 px-2">
					<Button
						size="icon"
						variant="ghost"
						aria-label="Useful"
						title="Useful"
						aria-pressed={i.vote === 'up'}
						onclick={() => onvote?.(i.id, 'up')}
						class={cn(i.vote === 'up' && 'bg-review-soft text-review hover:bg-review-soft')}
						><ThumbsUp /></Button
					>
					<Button
						size="icon"
						variant="ghost"
						aria-label="Not useful"
						title="Not useful"
						aria-pressed={i.vote === 'down'}
						onclick={() => onvote?.(i.id, 'down')}
						class={cn(i.vote === 'down' && 'bg-muted text-foreground hover:bg-muted')}
						><ThumbsDown /></Button
					>
					<Button
						variant="ghost"
						class="ml-auto text-muted-foreground"
						onclick={() => ondismiss?.(i.id, true)}><X />Dismiss</Button
					>
				</Card.Content>
			{/if}
		</Card.Root>
	</li>
{/snippet}

<DetailScreen
	title="Briefing"
	{back}
	{banner}
	state={{
		remote,
		isEmpty: briefing === null,
		empty: {
			title: 'No briefing yet today',
			body: 'The agent writes one each morning, with where each item came from.'
		},
		offline: !online,
		errorTitle: "Couldn't load the briefing.",
		onretry,
		skeleton
	}}
>
	{#if briefing}
		<ScreenContent>
			<PageIntro
				title={longDate(briefing.date, now)}
				description="{open} of {briefing.items.length} open · written at {clock(
					Date.parse(briefing.at)
				)}"
			/>
			{#if error}<p role="alert" class="text-sm text-failed">{error}</p>{/if}
			{#each sections as s (s.id)}
				{#if s.items.length}
					<Section title={s.label} tone="list">
						<ul class="flex flex-col gap-2">
							{#each s.items as i (i.id)}{@render item(i)}{/each}
						</ul>
					</Section>
				{/if}
			{/each}
			<p role="status" class="text-sm text-muted-foreground">
				{rated
					? `${rated} rated. Tomorrow's briefing leads with what you found useful.`
					: 'Rate items to tune what tomorrow leads with.'}
			</p>
		</ScreenContent>
	{/if}
</DetailScreen>
