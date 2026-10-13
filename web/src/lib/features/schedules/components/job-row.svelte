<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import * as Item from '$lib/ui/item';
	import StatePill from '$lib/ui/status/state-pill.svelte';
	import { nextRunLine } from '../format';
	import type { Job } from '../types';

	let { job, now, href }: { job: Job; now: number; href: string } = $props();
</script>

<Item.Root size="sm">
	{#snippet child({ props })}
		<a {href} {...props}>
			<Item.Content class="min-w-0">
				<div class="flex flex-wrap items-baseline justify-between gap-x-3">
					<Item.Title class="line-clamp-none [overflow-wrap:anywhere]">{job.name}</Item.Title>
					<span class="text-xs text-muted-foreground">{job.schedule}</span>
				</div>
				{#if job.last}
					<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
						<StatePill of={job.last.result} />
						<span class="min-w-0 text-xs [overflow-wrap:anywhere] text-muted-foreground"
							>{job.last.note}</span
						>
					</div>
				{/if}
				<p class="text-xs text-muted-foreground tabular-nums">{nextRunLine(job, now)}</p>
			</Item.Content>
			<Item.Actions>
				<ChevronRight class="size-4 text-muted-foreground" aria-hidden="true" />
			</Item.Actions>
		</a>
	{/snippet}
</Item.Root>
