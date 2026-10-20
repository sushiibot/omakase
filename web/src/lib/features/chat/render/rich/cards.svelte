<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import { Badge } from '$lib/ui/badge';
	import type { RichData } from './blocks';

	// Links or items worth scanning. `href` already passed the markdown link rule; others render as
	// plain cards.
	let { data }: { data: RichData<'cards'> } = $props();
	const box =
		'flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-3 text-sm text-card-foreground';
</script>

{#snippet body(item: RichData<'cards'>['items'][number])}
	<span class="flex items-start justify-between gap-2">
		<span class="font-medium">{item.title}</span>
		{#if item.href}<ArrowUpRight
				class="mt-0.5 size-4 shrink-0 text-muted-foreground"
				aria-hidden="true"
			/>{/if}
	</span>
	{#if item.subtitle}<span class="text-muted-foreground">{item.subtitle}</span>{/if}
	{#if item.badge || item.meta}
		<span class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
			{#if item.badge}<Badge variant="secondary">{item.badge}</Badge>{/if}
			{#if item.meta}<span>{item.meta}</span>{/if}
		</span>
	{/if}
{/snippet}

<ul class={['my-1 grid gap-2', data.items.length > 1 && 'sm:grid-cols-2']}>
	{#each data.items as item, i (i)}
		<li class="flex min-w-0">
			{#if item.href}
				<a
					href={item.href}
					target="_blank"
					rel="noopener noreferrer"
					class={[box, 'w-full no-underline hover:bg-muted']}>{@render body(item)}</a
				>
			{:else}
				<div class={[box, 'w-full']}>{@render body(item)}</div>
			{/if}
		</li>
	{/each}
</ul>
