<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { ago } from '$lib/ui/format/time';
	import * as Item from '$lib/ui/item';
	import StatePill from '$lib/ui/status/state-pill.svelte';
	import type { MemoryWriteRecord } from '../types';

	let { write, now, href }: { write: MemoryWriteRecord; now: number; href: string } = $props();
</script>

<Item.Root size="sm">
	{#snippet child({ props })}
		<a {href} {...props}>
			<Item.Content class="min-w-0">
				<Item.Title class="line-clamp-none [overflow-wrap:anywhere]">{write.summary}</Item.Title>
				<p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
					<span class="font-mono [overflow-wrap:anywhere]">{write.path}</span>
					<span aria-hidden="true">·</span>
					<span class="tabular-nums">{ago(write.at, now)}</span>
					{#if write.thread}<span>From thread · {write.thread.title}</span>{/if}
					{#if write.run}<span>From run · {write.run.title}</span>{/if}
				</p>
				{#if write.taint || write.reverted}
					<span class="flex flex-wrap gap-1.5">
						{#if write.taint}<StatePill of="tainted" />{/if}
						{#if write.reverted}<StatePill of="archived" label="Reverted" />{/if}
					</span>
				{/if}
			</Item.Content>
			<Item.Actions>
				<ChevronRight class="size-4 text-muted-foreground" aria-hidden="true" />
			</Item.Actions>
		</a>
	{/snippet}
</Item.Root>
