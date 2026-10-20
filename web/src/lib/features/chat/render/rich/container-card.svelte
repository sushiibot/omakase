<script lang="ts">
	import type { Snippet } from 'svelte';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';

	// `:::card` around markdown. The title links out when `href` passed the markdown link rule; the
	// body is never inside the link, so links in it stay separate.
	let {
		title,
		subtitle,
		href,
		children
	}: { title: string | null; subtitle: string | null; href: string | null; children: Snippet } =
		$props();
</script>

<section class="my-1 flex flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground">
	{#if title || subtitle}
		<div class="flex flex-col gap-0.5">
			{#if title && href}<a
					{href}
					target="_blank"
					rel="noopener noreferrer"
					class="flex items-center gap-1 font-semibold text-foreground underline-offset-4 hover:underline"
					>{title}<ArrowUpRight class="size-4 text-muted-foreground" aria-hidden="true" /></a
				>{:else if title}<span class="font-semibold">{title}</span>{/if}
			{#if subtitle}<span class="text-sm text-muted-foreground">{subtitle}</span>{/if}
		</div>
	{/if}
	<div class="flex flex-col gap-2">{@render children()}</div>
</section>
