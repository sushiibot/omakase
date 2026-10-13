<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import FileText from '@lucide/svelte/icons/file-text';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import NotebookText from '@lucide/svelte/icons/notebook-text';
	import { ago, dayLabel, fromDate } from '$lib/ui/format/time';
	import * as Item from '$lib/ui/item';
	import type { SearchHit } from '../types';
	import Highlight from './highlight.svelte';

	let {
		hit,
		now,
		href
	}: {
		hit: SearchHit;
		now: number;
		/** Where the hit opens; chat hits have no page of their own yet. */
		href?: string;
	} = $props();

	const source = $derived(
		hit.source === 'chat'
			? { label: hit.role === 'user' ? 'Chat · you' : 'Chat · the agent', icon: MessageSquare }
			: hit.kind === 'run'
				? { label: 'Run notes', icon: FileText }
				: { label: 'Day notes', icon: NotebookText }
	);
	const when = $derived(
		hit.source === 'chat' ? ago(hit.at, now) : dayLabel(fromDate(hit.date), now)
	);
</script>

{#snippet body()}
	<Item.Content class="min-w-0">
		<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
			<source.icon class="size-3.5 shrink-0" aria-hidden="true" />
			<span class="font-medium">{source.label}</span>
			<span aria-hidden="true">·</span>
			<span class="tabular-nums">{when}</span>
		</p>
		{#if hit.source === 'notes' && hit.heading}
			<Item.Title class="line-clamp-none [overflow-wrap:anywhere]">{hit.heading}</Item.Title>
		{/if}
		<Item.Description class="line-clamp-3 [overflow-wrap:anywhere] text-foreground"
			><Highlight text={hit.snippet} ranges={hit.ranges} /></Item.Description
		>
	</Item.Content>
{/snippet}

{#if href}
	<Item.Root size="sm">
		{#snippet child({ props })}
			<a {href} {...props}>
				{@render body()}
				<Item.Actions>
					<ChevronRight class="size-4 text-muted-foreground" aria-hidden="true" />
				</Item.Actions>
			</a>
		{/snippet}
	</Item.Root>
{:else}
	<Item.Root size="sm">{@render body()}</Item.Root>
{/if}
