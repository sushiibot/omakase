<!-- app: the one disclosure row over the stock Collapsible trigger (ux-guidelines.md#shared-component-patterns) -->
<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { cn } from '$lib/utils';
	import CollapsibleTrigger from './collapsible-trigger.svelte';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: ComponentProps<typeof CollapsibleTrigger> = $props();
</script>

<CollapsibleTrigger
	bind:ref
	class={cn(
		'group/disclosure flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 any-pointer-coarse:min-h-11',
		className
	)}
	{...restProps}
>
	<span class="flex min-w-0 flex-1 items-center gap-2">{@render children?.()}</span>
	<ChevronRight
		class="size-4 shrink-0 transition-transform duration-(--duration-short) group-data-[state=open]/disclosure:rotate-90 motion-reduce:transition-none"
		aria-hidden="true"
	/>
</CollapsibleTrigger>
