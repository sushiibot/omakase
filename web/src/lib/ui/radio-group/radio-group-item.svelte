<!-- shadcn-svelte nova: ui/radio-group/radio-group-item.svelte -->
<script lang="ts">
	import { RadioGroup as RadioGroupPrimitive } from 'bits-ui';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildrenOrChild<RadioGroupPrimitive.ItemProps> = $props();

	// axe and some screen readers ignore `<label for>` on a button, so name the radio from its labels.
	const uid = $props.id();
	let labelledby = $state<string>();
	$effect(() => {
		if (!(ref instanceof HTMLButtonElement) || restProps['aria-label']) return;
		const ids = [...ref.labels].map((label, i) => (label.id ||= `${uid}-label-${i}`));
		labelledby = ids.length ? ids.join(' ') : undefined;
	});
</script>

<RadioGroupPrimitive.Item
	bind:ref
	aria-labelledby={labelledby}
	data-slot="radio-group-item"
	class={cn(
		'group/radio-group-item peer relative flex aspect-square size-4 shrink-0 rounded-full border border-input outline-none group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-input after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 any-pointer-coarse:after:-inset-x-3.5 any-pointer-coarse:after:-inset-y-4.25 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground group-has-[:focus-visible]/field-label:data-checked:border-primary dark:data-checked:bg-primary',
		className
	)}
	{...restProps}
>
	{#snippet children({ checked })}
		<div data-slot="radio-group-indicator" class="flex size-4 items-center justify-center">
			{#if checked}
				<CircleIcon
					class="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground"
				/>
			{/if}
		</div>
	{/snippet}
</RadioGroupPrimitive.Item>
