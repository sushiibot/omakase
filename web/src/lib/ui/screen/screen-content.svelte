<script lang="ts">
	import type { Snippet } from 'svelte';
	import { PageBody, type PageMeasure } from '$lib/ui/page';
	import { cn } from '$lib/utils';
	import { getScreenContext } from './context';

	const screen = getScreenContext();

	let {
		children,
		measure = screen?.measure ?? 'reading',
		embedded = false,
		class: className
	}: {
		children: Snippet;
		/** Defaults to the enclosing Screen's measure. */
		measure?: PageMeasure;
		/** The containing screen already owns width and gutters. */
		embedded?: boolean;
		class?: string;
	} = $props();
</script>

{#if embedded}
	<div data-slot="screen-content" class={cn('flex min-w-0 flex-col gap-4 md:gap-6', className)}>
		{@render children()}
	</div>
{:else}
	<PageBody {measure} class={cn('antialiased', className)}>
		{@render children()}
	</PageBody>
{/if}
