<!-- shadcn-svelte nova: ui/trace/trace-description.svelte -->
<!-- drift: full muted-foreground, since /70 fails WCAG AA contrast -->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLSpanElement>> = $props();
</script>

<span
	bind:this={ref}
	data-slot="trace-description"
	class={cn('shrink-0 text-muted-foreground tabular-nums', className)}
	{...restProps}
>
	{@render children?.()}
</span>
