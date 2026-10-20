<script lang="ts">
	import { formatNumber, richPlainText, shares, type RichData } from './blocks';
	import Frame from './frame.svelte';
	import { vizFill } from './viz';

	// Parts of a whole. The total and the percentages are computed here, never taken from the model,
	// so the headline, the bar and the legend always agree.
	let { data }: { data: RichData<'breakdown'> } = $props();
	const total = $derived(data.segments.reduce((a, s) => a + s.value, 0));
	const pct = $derived(shares(data.segments.map((s) => s.value)));
</script>

<Frame title={data.title} note={data.note} label={richPlainText({ type: 'breakdown', data })}>
	<!-- Kept while a streaming block has no segment yet, so the box doesn't grow when one lands. -->
	<p
		class={['text-2xl font-semibold tabular-nums', !data.segments.length && 'invisible']}
		aria-hidden="true"
	>
		{formatNumber(total)}{#if data.unit}<span
				class="ml-1 text-base font-medium text-muted-foreground">{data.unit}</span
			>{/if}
	</p>
	<div class="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
		{#each data.segments as segment, i (i)}
			{#if segment.value > 0}<div
					class={['h-full min-w-1', vizFill(i)]}
					style:flex-grow={segment.value}
				></div>{/if}
		{/each}
	</div>
	<ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden="true">
		{#each data.segments as segment, i (i)}
			<li class="flex items-center gap-1.5">
				<span class={['size-2.5 shrink-0 rounded-full', vizFill(i)]}></span>
				<span class="text-foreground">{segment.label}</span>
				<span class="tabular-nums">{pct[i]}%</span>
			</li>
		{/each}
	</ul>
</Frame>
