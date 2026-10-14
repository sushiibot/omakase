<!-- app: modeled on shadcn-svelte dashboard-01 main and the sidebar-10/15 content column (ux-guidelines.md#spacing-and-density) -->
<script lang="ts" module>
	export type PageMeasure = 'reading' | 'full';

	/** Width only, for wrappers that keep their own gutters, such as a tab pager. */
	export const measureClass: Record<PageMeasure, string> = {
		reading: 'mx-auto w-full max-w-3xl',
		full: 'w-full'
	};
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	let {
		measure = 'reading',
		class: className,
		children
	}: {
		/** `reading` centers a column; `full` spans the inset for dense lists and tables. */
		measure?: PageMeasure;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<div
	data-slot="page-body"
	class={cn(
		'flex min-w-0 flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6',
		measureClass[measure],
		className
	)}
>
	{@render children()}
</div>
