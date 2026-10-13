<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	let {
		label,
		children,
		actions,
		class: className
	}: { label: string; children: Snippet; actions?: Snippet; class?: string } = $props();
</script>

<div
	class={cn(
		'flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm',
		className
	)}
>
	<p class="shrink-0 text-muted-foreground">{label}</p>
	<div class="ml-auto min-w-0 text-right [overflow-wrap:anywhere]">{@render children()}</div>
	{@render actions?.()}
</div>
