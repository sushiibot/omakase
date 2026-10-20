<script lang="ts">
	import TrendingDown from '@lucide/svelte/icons/trending-down';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import Minus from '@lucide/svelte/icons/minus';
	import { formatNumber, type RichData } from './blocks';
	import Frame from './frame.svelte';

	// Headline numbers. A trend is green only when the block says which direction is good.
	let { data }: { data: RichData<'stats'> } = $props();
	type Item = RichData<'stats'>['items'][number];
	const trendClass = (s: Item) =>
		!s.trend || s.trend === 'flat' || !s.good
			? 'text-muted-foreground'
			: s.trend === s.good
				? 'text-review'
				: 'text-failed';
</script>

<Frame title={data.title}>
	<dl class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
		{#each data.items as item, i (i)}
			<div class="flex min-w-0 flex-col gap-0.5">
				<dt class="text-xs text-muted-foreground">{item.label}</dt>
				<dd class="text-2xl font-semibold tabular-nums">
					{typeof item.value === 'number'
						? formatNumber(item.value)
						: item.value}{#if item.unit}<span class="ml-1 text-sm font-medium text-muted-foreground"
							>{item.unit}</span
						>{/if}
				</dd>
				{#if item.delta || item.trend}
					<dd class={['flex items-center gap-1 text-xs', trendClass(item)]}>
						{#if item.trend === 'up'}<TrendingUp class="size-3.5" aria-hidden="true" /><span
								class="sr-only">Up</span
							>{:else if item.trend === 'down'}<TrendingDown
								class="size-3.5"
								aria-hidden="true"
							/><span class="sr-only">Down</span>{:else if item.trend === 'flat'}<Minus
								class="size-3.5"
								aria-hidden="true"
							/><span class="sr-only">Flat</span>{/if}
						{#if item.delta}<span class="tabular-nums">{item.delta}</span>{/if}
					</dd>
				{/if}
			</div>
		{/each}
	</dl>
</Frame>
