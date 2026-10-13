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
		/** `bordered`: flush rows in one bordered box, divided by rules. */
		variant?: 'default' | 'bordered';
	} = $props();
</script>

<div
	bind:this={ref}
	role="list"
	data-slot="item-group"
	data-variant={variant === 'default' ? undefined : variant}
	class={cn(
		'group/item-group flex w-full flex-col gap-4 has-data-[size=sm]:gap-2.5 has-data-[size=xs]:gap-2',
		variant === 'bordered' &&
			'gap-0 overflow-hidden rounded-xl border *:not-first:border-t has-data-[size=sm]:gap-0 has-data-[size=xs]:gap-0 *:*:data-[slot=item]:rounded-none *:data-[slot=item]:rounded-none *:*:data-[slot=item]:focus-visible:ring-inset *:data-[slot=item]:focus-visible:ring-inset',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
