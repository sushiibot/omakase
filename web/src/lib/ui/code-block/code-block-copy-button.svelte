<!-- shadcn-svelte nova: ui/code-block/code-block-copy-button.svelte -->
<!-- drift: label prop, icon-sm default, and a "Couldn't copy" announcement when the clipboard refuses -->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import { Button, type ButtonProps } from '$lib/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		value,
		label = 'Copy',
		variant = 'ghost',
		size = 'icon-sm',
		onclick,
		...restProps
	}: Omit<ButtonProps, 'onclick'> & {
		value: string;
		/** The button's accessible name. */
		label?: string;
		onclick?: (e: MouseEvent) => void;
	} = $props();

	let copied = $state(false);
	let announcement = $state('');
	let timeout: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		clearTimeout(timeout);
		try {
			if (!navigator.clipboard) throw new Error('no clipboard');
			await navigator.clipboard.writeText(value);
			copied = true;
			announcement = 'Copied';
		} catch {
			copied = false;
			announcement = "Couldn't copy";
		}
		timeout = setTimeout(() => {
			copied = false;
			announcement = '';
		}, 2000);
	}

	onDestroy(() => clearTimeout(timeout));
</script>

<Button
	bind:ref
	data-slot="code-block-copy-button"
	data-copied={copied || undefined}
	{variant}
	{size}
	aria-label={label}
	class={cn(className)}
	onclick={(e) => {
		onclick?.(e);
		copy();
	}}
	{...restProps}
>
	{#if copied}
		<CheckIcon aria-hidden="true" />
	{:else}
		<CopyIcon aria-hidden="true" />
	{/if}
</Button>
<span aria-live="polite" class="sr-only">{announcement}</span>
