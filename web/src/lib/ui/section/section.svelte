<!-- app: section heading with optional description, count and aside (ux-guidelines.md#shared-component-patterns) -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	let {
		id,
		title,
		count,
		tone = 'default',
		description,
		icon,
		aside,
		children,
		class: className
	}: {
		id?: string;
		title: string;
		count?: number;
		/** List headings recede beneath page titles and row names. */
		tone?: 'default' | 'list';
		description?: string;
		icon?: Snippet;
		aside?: Snippet;
		children: Snippet;
		class?: string;
	} = $props();
	const uid = $props.id();
	const headingId = $derived(id ?? `${uid}-heading`);
</script>

<section
	aria-labelledby={title ? `${headingId}-title` : undefined}
	class={cn('flex min-w-0 flex-col gap-2', className)}
>
	{#if title}
		<div
			class={cn(
				'flex flex-wrap items-center justify-between gap-x-4 gap-y-1',
				tone === 'list' && 'min-h-8 px-3'
			)}
		>
			<h2
				id={headingId}
				class={cn(
					'flex items-center gap-2',
					tone === 'list' ? 'text-xs font-medium text-muted-foreground' : 'text-sm font-medium'
				)}
			>
				{@render icon?.()}
				<span id="{headingId}-title">{title}</span>
				{#if count !== undefined}
					<span aria-hidden="true" class="font-normal text-muted-foreground tabular-nums"
						>{count}</span
					><span class="sr-only">, {count}</span>
				{/if}
			</h2>
			{#if aside}<div class="text-xs text-muted-foreground">{@render aside()}</div>{/if}
		</div>
	{/if}
	{#if description}<p class="max-w-prose text-sm text-muted-foreground">{description}</p>{/if}
	{@render children()}
</section>
