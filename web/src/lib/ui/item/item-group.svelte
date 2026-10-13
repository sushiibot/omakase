<!-- shadcn-svelte nova: ui/item/item-group.svelte -->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'default',
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		/** `outline`: flush rows in one bordered box, divided by rules. */
		variant?: 'default' | 'outline';
	} = $props();
</script>

<div
	bind:this={ref}
	role="list"
	data-slot="item-group"
	data-variant={variant}
	class={cn(
		'group/item-group flex w-full flex-col gap-4 has-data-[size=sm]:gap-2.5 has-data-[size=xs]:gap-2',
		variant === 'outline' &&
			'gap-0 overflow-hidden rounded-xl border *:not-first:border-t has-data-[size=sm]:gap-0 has-data-[size=xs]:gap-0 **:data-[slot=item]:rounded-none',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
