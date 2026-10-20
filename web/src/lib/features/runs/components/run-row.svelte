<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CornerUpRight from '@lucide/svelte/icons/corner-up-right';
	import { Button } from '$lib/ui/button';
	import { ago } from '$lib/ui/format/time';
	import * as Item from '$lib/ui/item';
	import StatePill from '$lib/ui/status/state-pill.svelte';
	import { kindLabel, activityTitle, runResultHref } from '../format';
	import type { RunSummary } from '../types';
	import { cn } from '$lib/utils';

	let {
		run,
		now,
		href,
		jump = true,
		reserveJump = false
	}: {
		run: RunSummary;
		now: number;
		href: string;
		jump?: boolean;
		/** Keep the jump slot on a row without a conversation, so a list's chevrons line up. */
		reserveJump?: boolean;
	} = $props();
	// The reply the run delivered when there is one, else its place in the conversation.
	const chatHref = $derived(jump ? runResultHref(run) : undefined);
	const jumpLabel = $derived(run.result ? 'Open result' : 'Jump to conversation');
</script>

<div class="flex min-w-0 items-center gap-2">
	<Item.Root size="sm" class="min-w-0 flex-1 flex-nowrap">
		{#snippet child({ props })}
			<a {href} {...props}>
				<Item.Content class="min-w-0">
					<Item.Title class="block max-w-full truncate"
						>{run.kind === 'flush' || run.kind === 'rotate'
							? activityTitle(run)
							: run.title || activityTitle(run)}</Item.Title
					>
					<span class="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
						<StatePill of={run.status} label={run.status === 'done' ? 'Finished' : undefined} />
						<span class="truncate">{kindLabel(run)}</span>
						<span class="shrink-0 tabular-nums">{ago(run.startedAt, now)}</span>
					</span>
				</Item.Content>
				<Item.Actions>
					<ChevronRight class="size-4 text-muted-foreground" aria-hidden="true" />
				</Item.Actions>
			</a>
		{/snippet}
	</Item.Root>
	{#if chatHref || (jump && reserveJump)}
		<Button
			href={chatHref}
			variant="ghost"
			size="sm"
			aria-label={jumpLabel}
			title={jumpLabel}
			aria-hidden={chatHref ? undefined : 'true'}
			tabindex={chatHref ? undefined : -1}
			class={cn('text-muted-foreground', !chatHref && 'invisible')}
		>
			<CornerUpRight
				aria-hidden="true"
			/><!-- Sized to the longer label, so a list's chevrons line up. --><span
				class="hidden justify-items-start sm:inline-grid"
				><span class="col-start-1 row-start-1">{jumpLabel}</span><span
					class="invisible col-start-1 row-start-1"
					aria-hidden="true">Jump to conversation</span
				></span
			>
		</Button>
	{/if}
</div>
