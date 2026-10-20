<script lang="ts" module>
	export type RowTone = 'waiting' | 'failed' | 'running' | 'review' | 'muted';
</script>

<script lang="ts">
	// The HomeRow anatomy for rows that aren't Home items: a conversation, a task, live work.
	import type { Component } from 'svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { Button } from '$lib/ui/button';
	import { Spinner } from '$lib/ui/spinner';
	import { cn } from '$lib/utils';

	let {
		title,
		sub,
		when,
		href,
		onclick,
		tone = 'muted',
		icon,
		iconLabel,
		spinning = false,
		unread = false,
		muted = false
	}: {
		title: string;
		sub?: string;
		when?: string;
		/** A link row; leave out for a button row with `onclick`. */
		href?: string;
		onclick?: () => void;
		tone?: RowTone;
		icon?: Component;
		/** Names the icon for assistive tech; without it the icon is decorative. */
		iconLabel?: string;
		/** A spinner in place of the icon, for live work; the row's text says what it waits on. */
		spinning?: boolean;
		/** New messages since this device last opened it. */
		unread?: boolean;
		/** A finished or quiet record: a lighter title. */
		muted?: boolean;
	} = $props();
	const Icon = $derived(icon);
</script>

<!-- The wrapper takes the list's rule: the Button's own transparent border would hide it. -->
<div>
	<Button
		{href}
		{onclick}
		variant="ghost"
		class="h-auto w-full items-start justify-start gap-3 rounded-xl bg-background px-2 py-2.5 text-left font-normal whitespace-normal hover:bg-muted/60 dark:hover:bg-muted/60 any-pointer-coarse:after:hidden"
	>
		<span
			class={cn(
				'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full',
				tone === 'waiting' && 'bg-waiting-soft text-waiting',
				tone === 'failed' && 'bg-failed-soft text-failed',
				tone === 'running' && 'bg-running-soft text-running',
				tone === 'review' && 'bg-review-soft text-review',
				tone === 'muted' && 'bg-muted text-muted-foreground'
			)}
		>
			{#if spinning}
				<Spinner role="img" aria-label="Running" class="[animation-duration:2s]" />
			{:else if Icon}
				{#if iconLabel}<Icon class="size-4" aria-label={iconLabel} />{:else}<Icon
						class="size-4"
						aria-hidden="true"
					/>{/if}
			{/if}
		</span>
		<span class="flex min-w-0 flex-1 flex-col gap-0.5">
			<span class="flex items-baseline justify-between gap-3">
				<span
					class={cn(
						'line-clamp-2 text-ui [overflow-wrap:anywhere]',
						muted ? 'text-muted-foreground' : 'font-medium'
					)}
					>{title}{#if unread}<span
							class="ms-2 inline-block size-2 rounded-full bg-brand align-middle"
							aria-hidden="true"
						></span><span class="sr-only">, new messages</span>{/if}</span
				>
				{#if when}<span class="shrink-0 text-meta text-muted-foreground tabular-nums">{when}</span
					>{/if}
			</span>
			{#if sub}<span class="line-clamp-1 text-sm [overflow-wrap:anywhere] text-muted-foreground"
					>{sub}</span
				>{/if}
		</span>
		<ChevronRight class="mt-2 shrink-0 text-muted-foreground" aria-hidden="true" />
	</Button>
</div>
