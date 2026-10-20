<script lang="ts">
	import { withUnit, richPlainText, type RichData } from './blocks';
	import Frame from './frame.svelte';

	// One number across labelled things, scaled to the largest.
	let { data }: { data: RichData<'bars'> } = $props();
	const max = $derived(Math.max(...data.items.map((i) => i.value)) || 1);
	const anyHighlight = $derived(data.items.some((i) => i.highlight));
</script>

<Frame title={data.title} note={data.note} label={richPlainText({ type: 'bars', data })}>
	<div
		class="grid grid-cols-[fit-content(40%)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2"
		aria-hidden="true"
	>
		{#each data.items as item, i (i)}
			<span class="truncate text-xs">{item.label}</span>
			<div class="h-2.5 rounded-full bg-muted">
				<div
					class={[
						'h-full min-w-1 rounded-full',
						item.highlight || !anyHighlight ? 'bg-viz-1' : 'bg-viz-1/40'
					]}
					style:width="{(item.value / max) * 100}%"
				></div>
			</div>
			<span class="text-xs text-muted-foreground tabular-nums"
				>{withUnit(item.value, data.unit)}</span
			>
		{/each}
	</div>
</Frame>
