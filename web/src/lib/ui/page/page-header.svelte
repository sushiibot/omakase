<!-- modeled on shadcn-svelte dashboard-01 site-header and the sidebar-10/15 inset header -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Separator } from '$lib/ui/separator';
	import { cn } from '$lib/utils';

	let {
		title,
		subtitle,
		leading,
		leadingClass,
		breadcrumb,
		actions,
		class: className
	}: {
		title: string;
		subtitle?: Snippet;
		/** A drawer button or back link, followed by a separator. */
		leading?: Snippet;
		/** Classes for the leading group, such as hiding it where the sidebar already leads there. */
		leadingClass?: string;
		/** Replaces the visible title from `md` up; the h1 stays for assistive tech. */
		breadcrumb?: Snippet;
		actions?: Snippet;
		class?: string;
	} = $props();
</script>

<header
	data-slot="page-header"
	class={cn(
		'sticky top-0 z-10 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background px-4 lg:px-6',
		className
	)}
>
	{#if leading}
		<div class={cn('flex shrink-0 items-center gap-2', leadingClass)}>
			{@render leading()}
			<Separator orientation="vertical" class="me-2 data-vertical:h-4 data-vertical:self-auto" />
		</div>
	{/if}
	<div class={cn('flex min-w-0 flex-col', breadcrumb && 'md:contents')}>
		<h1 class={cn('truncate text-base font-medium', breadcrumb && 'md:sr-only')}>{title}</h1>
		{#if subtitle}
			<div class={cn('truncate text-xs text-muted-foreground', breadcrumb && 'md:hidden')}>
				{@render subtitle()}
			</div>
		{/if}
	</div>
	{#if breadcrumb}
		<div class="hidden min-w-0 md:flex">{@render breadcrumb()}</div>
	{/if}
	{#if actions}
		<div class="ms-auto flex shrink-0 items-center gap-2">{@render actions()}</div>
	{/if}
</header>
