<script lang="ts">
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import type { RichData } from './blocks';
	import Frame from './frame.svelte';
	import { toneLabel, toneSurface } from './viz';

	// Ordered stages with an arrow between each. `right` lays out across from the sm breakpoint and
	// stacks on phones, where a row of boxes would be too narrow to read.
	let { data }: { data: RichData<'flow'> } = $props();
	const across = $derived(data.direction === 'right');
</script>

<Frame title={data.title} note={data.note}>
	<ol class={['flex flex-col items-stretch gap-1', across && 'sm:flex-row sm:items-center']}>
		{#each data.steps as step, i (i)}
			{#if i > 0}
				<li aria-hidden="true" class="flex justify-center text-muted-foreground">
					<ArrowDown class={['size-4', across && 'sm:hidden']} />
					{#if across}<ArrowRight class="hidden size-4 sm:block" />{/if}
				</li>
			{/if}
			<li
				class={[
					'flex flex-1 flex-col gap-0.5 rounded-lg px-3 py-2.5 text-center',
					toneSurface[step.tone ?? 'neutral']
				]}
			>
				<span class="font-medium">{step.title}</span>
				{#if step.detail}<span class="text-xs text-muted-foreground">{step.detail}</span>{/if}
				{#if step.tone && step.tone !== 'neutral'}<span class="sr-only"
						>({toneLabel[step.tone]})</span
					>{/if}
			</li>
		{/each}
	</ol>
</Frame>
