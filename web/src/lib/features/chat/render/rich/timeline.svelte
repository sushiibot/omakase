<script lang="ts">
	import type { RichData } from './blocks';
	import Frame from './frame.svelte';
	import { toneDot, toneLabel } from './viz';

	// Dated or ordered entries on a rail.
	let { data }: { data: RichData<'timeline'> } = $props();
</script>

<Frame title={data.title}>
	<ol class="flex flex-col">
		{#each data.items as item, i (i)}
			<li class="relative flex gap-3 pb-4 last:pb-0">
				{#if i < data.items.length - 1}<span
						class="absolute top-3 bottom-0 left-[4.5px] w-px bg-border"
						aria-hidden="true"
					></span>{/if}
				<span
					class={[
						'relative mt-1.5 size-2.5 shrink-0 rounded-full',
						toneDot[item.tone ?? 'neutral']
					]}
					aria-hidden="true"
				></span>
				<div class="flex min-w-0 flex-col gap-0.5">
					<span class="text-xs text-muted-foreground tabular-nums">{item.when}</span>
					<span class="font-medium"
						>{item.title}{#if item.tone && item.tone !== 'neutral'}<span class="sr-only">
								({toneLabel[item.tone]})</span
							>{/if}</span
					>
					{#if item.detail}<span class="text-muted-foreground">{item.detail}</span>{/if}
				</div>
			</li>
		{/each}
	</ol>
</Frame>
