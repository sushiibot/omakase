<!-- app: the one search field, built from the stock InputGroup (ux-guidelines.md#shared-component-patterns) -->
<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import * as InputGroup from '$lib/ui/input-group';

	let {
		label,
		placeholder = `${label}…`,
		value = $bindable(''),
		ref = $bindable(null),
		disabled = false,
		class: className
	}: {
		/** The accessible name; the placeholder must start with the same words. */
		label: string;
		placeholder?: string;
		value?: string;
		ref?: HTMLInputElement | null;
		disabled?: boolean;
		class?: string;
	} = $props();
</script>

<InputGroup.Root class={className}>
	<InputGroup.Input
		type="search"
		aria-label={label}
		{placeholder}
		{disabled}
		bind:value
		bind:ref
		class="[&::-webkit-search-cancel-button]:appearance-none"
	/>
	<InputGroup.Addon><Search /></InputGroup.Addon>
	{#if value}<InputGroup.Addon align="inline-end">
			<!-- The touch reach stays within the field's height, off the controls above and below. -->
			<InputGroup.Button
				size="icon-xs"
				aria-label="Clear search"
				class="any-pointer-coarse:after:-inset-y-1.25"
				{disabled}
				onclick={() => {
					value = '';
					ref?.focus({ preventScroll: true });
				}}><X /></InputGroup.Button
			>
		</InputGroup.Addon>{/if}
</InputGroup.Root>
