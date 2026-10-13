<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import { Button } from '$lib/ui/button';
	import { PageHeader } from '$lib/ui/page';

	let {
		title,
		level = 1,
		backLabel,
		onback,
		subtitle,
		actions
	}: {
		title: string;
		/** 2 inside the side panel, under its own tabs. */
		level?: 1 | 2;
		backLabel: string;
		onback: () => void;
		subtitle?: Snippet;
		actions?: Snippet;
	} = $props();
</script>

{#snippet leading()}
	<Button
		size="icon-sm"
		variant="ghost"
		class="-ms-1 text-muted-foreground"
		aria-label={backLabel}
		onclick={onback}><ChevronLeft /></Button
	>
{/snippet}

<PageHeader {title} {level} {leading} {subtitle} {actions} />
