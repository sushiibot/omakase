<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Switch as SwitchPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';

	let {
		checked,
		compact = false,
		disabled = false,
		describedby,
		onchange,
		class: className,
		children
	}: {
		checked: boolean;
		/** Smaller painted switch; the full row remains the touch target. */
		compact?: boolean;
		disabled?: boolean;
		describedby?: string;
		/** The switch stays as `checked` says until the caller changes it. */
		onchange: (next: boolean) => void;
		class?: string;
		/** The label (and any status line); the whole row is the control. */
		children: Snippet;
	} = $props();
</script>

<SwitchPrimitive.Root
	bind:checked={() => checked, (next) => onchange(next)}
	{disabled}
	aria-describedby={describedby}
	class={cn(
		'group/switch flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left disabled:cursor-not-allowed',
		compact && 'min-h-12',
		className
	)}
>
	<span class="flex min-w-0 flex-1 flex-col gap-0.5">{@render children()}</span>
	<span
		aria-hidden="true"
		class={cn(
			'relative inline-flex shrink-0 items-center rounded-full bg-input p-0.5 transition-colors duration-(--duration-short) group-data-checked/switch:bg-primary group-data-disabled/switch:opacity-50 motion-reduce:transition-none',
			compact ? 'h-5 w-9' : 'h-7 w-12'
		)}
	>
		<SwitchPrimitive.Thumb
			class={cn(
				'rounded-full bg-background shadow-sm transition-transform duration-(--duration-short) motion-reduce:transition-none',
				compact ? 'size-4 data-checked:translate-x-4' : 'size-6 data-checked:translate-x-5'
			)}
		/>
	</span>
</SwitchPrimitive.Root>
