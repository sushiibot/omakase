<script lang="ts">
	import type { Snippet } from 'svelte';

	// The shared box around a rich block: a titled figure with an optional note under it.
	let {
		title,
		note,
		label,
		children
	}: {
		title?: string;
		note?: string;
		/** Text alternative for a visual-only body; the figure is then announced as one image. */
		label?: string;
		children: Snippet;
	} = $props();
</script>

<figure
	class="my-1 flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-sm text-card-foreground"
>
	{#if title}<figcaption class="text-sm font-medium">{title}</figcaption>{/if}
	{#if label}
		<div role="img" aria-label={label} class="flex min-w-0 flex-col gap-3">
			{@render children()}
		</div>
	{:else}
		{@render children()}
	{/if}
	{#if note}<p class="text-xs text-muted-foreground">{note}</p>{/if}
</figure>
