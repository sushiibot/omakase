<script lang="ts">
	import { richPlainText, type RichData } from './blocks';
	import Frame from './frame.svelte';
	import { vizFill } from './viz';

	// A 2×2: items placed by x and y from 0 to 1, high y at the top.
	let { data }: { data: RichData<'matrix'> } = $props();
</script>

<Frame title={data.title} label={richPlainText({ type: 'matrix', data })}>
	<div class="flex flex-col gap-1 text-xs text-muted-foreground" aria-hidden="true">
		<span class="self-start">↑ {data.y.high}</span>
		<div class="relative aspect-square w-full rounded-lg border sm:w-80">
			<div class="absolute inset-y-0 left-1/2 w-px bg-border"></div>
			<div class="absolute inset-x-0 top-1/2 h-px bg-border"></div>
			{#each data.items as item, i (i)}
				<div
					class="absolute flex w-24 -translate-x-1/2 translate-y-1/2 flex-col items-center gap-0.5"
					style:left="{4 + item.x * 92}%"
					style:bottom="{4 + item.y * 92}%"
				>
					<span class={['size-2.5 rounded-full ring-2 ring-card', vizFill(i)]}></span>
					<span class="max-w-full truncate rounded bg-card/80 px-1 text-center text-foreground"
						>{item.label}</span
					>
				</div>
			{/each}
		</div>
		<span>↓ {data.y.low}</span>
		<div class="flex justify-between gap-2 sm:w-80">
			<span>← {data.x.low}</span>
			<span>{data.x.high} →</span>
		</div>
	</div>
</Frame>
