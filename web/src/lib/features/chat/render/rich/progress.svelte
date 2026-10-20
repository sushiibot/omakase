<script lang="ts">
	import { withUnit, type RichData } from './blocks';
	import Frame from './frame.svelte';

	// Values against a target. Past 100% the bar stays full and the percentage says by how much.
	let { data }: { data: RichData<'progress'> } = $props();
	// `max` > 0 is checked once the block is finished; a streaming one may not have been yet.
	const pct = (v: number, max: number) => (max > 0 ? Math.round((v / max) * 100) : 0);
</script>

<Frame title={data.title}>
	<ul class="flex flex-col gap-3">
		{#each data.items as item, i (i)}
			{@const p = pct(item.value, item.max)}
			<li class="flex flex-col gap-1">
				<div class="flex items-baseline justify-between gap-3 text-xs">
					<span class="font-medium">{item.label}</span>
					<span class="text-muted-foreground tabular-nums"
						>{withUnit(item.value, item.unit)} / {withUnit(item.max, item.unit)} · {p}%</span
					>
				</div>
				<div
					class="h-2 rounded-full bg-muted"
					role="progressbar"
					aria-label={item.label}
					aria-valuemin={0}
					aria-valuemax={item.max}
					aria-valuenow={item.value}
				>
					<div
						class={['h-full rounded-full', p > 100 ? 'bg-failed' : 'bg-viz-1']}
						style:width="{Math.min(p, 100)}%"
					></div>
				</div>
			</li>
		{/each}
	</ul>
</Frame>
