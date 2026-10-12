<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CornerUpRight from '@lucide/svelte/icons/corner-up-right';
	import { ago } from '$lib/ui/format/time';
	import StatePill from '$lib/ui/status/state-pill.svelte';
	import { kindLabel, activityTitle, runConversationHref } from '../format';
	import type { RunSummary } from '../types';

	let {
		run,
		now,
		href,
		jump = true
	}: { run: RunSummary; now: number; href: string; jump?: boolean } = $props();
	const chatHref = $derived(jump ? runConversationHref(run) : undefined);
</script>

<div class="flex min-w-0 items-center gap-1">
	<a
		{href}
		class="flex min-h-14 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
	>
		<span class="flex min-w-0 flex-1 flex-col gap-1">
			<span class="truncate text-ui font-medium"
				>{run.kind === 'flush' || run.kind === 'rotate'
					? activityTitle(run)
					: run.title || activityTitle(run)}</span
			>
			<span class="flex min-w-0 items-center gap-2 text-meta text-muted-foreground">
				<StatePill of={run.status} label={run.status === 'done' ? 'Finished' : undefined} />
				<span class="truncate">{kindLabel(run)}</span>
				<span class="shrink-0 tabular-nums">{ago(run.startedAt, now)}</span>
			</span>
		</span>
		<ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
	</a>
	{#if chatHref}
		<a
			href={chatHref}
			aria-label="Jump to conversation"
			title="Jump to conversation"
			class="flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-2 rounded-lg px-2 text-meta text-muted-foreground hover:bg-muted/60 hover:text-foreground"
		>
			<CornerUpRight class="size-4" aria-hidden="true" /><span class="hidden sm:inline"
				>Jump to conversation</span
			>
		</a>
	{/if}
</div>
