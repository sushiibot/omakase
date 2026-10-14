<!-- app: modeled on shadcn-svelte card-header: title, description and a trailing action (ux-guidelines.md#shared-component-patterns) -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	let {
		title,
		description,
		actions,
		class: className
	}: {
		/** Only when the page needs a second title under the header, such as a run's name. */
		title?: string;
		description?: string | Snippet;
		actions?: Snippet;
		class?: string;
	} = $props();
</script>

<div data-slot="page-intro" class={cn('flex items-start justify-between gap-4', className)}>
	<div class="flex min-w-0 flex-col gap-1">
		{#if title}<h2 class="text-base font-medium">{title}</h2>{/if}
		{#if typeof description === 'string'}
			<p class="text-sm text-muted-foreground">{description}</p>
		{:else if description}
			<div class="text-sm text-muted-foreground">{@render description()}</div>
		{/if}
	</div>
	{#if actions}<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>{/if}
</div>
