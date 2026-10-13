<script lang="ts">
	import type { Snippet } from 'svelte';
	import { RadioGroup as RadioGroupPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';

	let {
		value,
		compact = false,
		variant = 'card',
		class: className,
		children
	}: {
		value: string;
		compact?: boolean;
		variant?: 'card' | 'segment';
		class?: string;
		children: Snippet;
	} = $props();
</script>

<RadioGroupPrimitive.Item
	{value}
	class={cn(
		'group h-12 min-w-12 text-sm font-medium text-muted-foreground data-checked:text-foreground',
		variant === 'segment'
			? 'flex shrink-0 items-center px-0.5 desktop-pointer:h-8'
			: compact
				? 'flex shrink-0 items-center'
				: 'rounded-xl border bg-card data-checked:border-foreground',
		className
	)}
>
	{#if variant === 'segment'}
		<span
			class="flex h-7 min-w-16 items-center justify-center rounded-md px-3 group-data-checked:bg-background group-data-checked:shadow-sm"
			>{@render children()}</span
		>
	{:else if compact}
		<span
			class="flex h-8 items-center justify-center rounded-full border bg-card px-3 group-data-checked:border-foreground"
			>{@render children()}</span
		>
	{:else}
		{@render children()}
	{/if}
</RadioGroupPrimitive.Item>
