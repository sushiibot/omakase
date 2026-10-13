<script lang="ts">
	import { RadioGroup as RadioGroupPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		value = $bindable(''),
		layout = 'stack',
		...restProps
	}: RadioGroupPrimitive.RootProps & { layout?: 'stack' | 'segmented' } = $props();
</script>

<RadioGroupPrimitive.Root
	bind:ref
	bind:value
	data-slot="radio-group"
	class={cn(
		layout === 'segmented'
			? 'relative isolate flex w-fit gap-0 before:absolute before:inset-x-0 before:inset-y-2 before:-z-10 before:rounded-lg before:bg-muted desktop-pointer:before:inset-y-0'
			: 'grid w-full gap-2',
		className
	)}
	{...restProps}
/>
