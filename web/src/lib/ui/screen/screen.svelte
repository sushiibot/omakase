<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import Menu from '@lucide/svelte/icons/menu';
	import { Button } from '$lib/ui/button';
	import { measureClass, PageHeader, type PageMeasure } from '$lib/ui/page';
	import { cn } from '$lib/utils';
	import { getDrawer } from '../shell/drawer';

	let {
		title,
		subtitle,
		back,
		actions,
		banner,
		toast,
		toastPosition = 'bottom',
		footer,
		measure,
		stickToBottom = false,
		channelNavigation = false,
		scrollable = true,
		scroller = $bindable(null),
		children
	}: {
		title: string;
		subtitle?: Snippet;
		/** `desktop: false` hides it where the sidebar already leads there. */
		back?: { href: string; label: string; onclick?: (e: MouseEvent) => void; desktop?: boolean };
		actions?: Snippet;
		/** Under the header, outside the scroll. */
		banner?: Snippet;
		/** A transient line above the footer, or below the header for chat. */
		toast?: Snippet;
		toastPosition?: 'top' | 'bottom';
		footer?: Snippet;
		/** Lines the footer up with the body; leave out when the footer lays itself out, as chat does. */
		measure?: PageMeasure;
		/** Disable when the content owns its vertical scroll, such as a tab pager. */
		scrollable?: boolean;
		/** Keep the newest content in view, for chats. */
		stickToBottom?: boolean;
		channelNavigation?: boolean;
		/** The scrolling region, for callers that track the reader's position. */
		scroller?: HTMLElement | null;
		children: Snippet;
	} = $props();

	// A screen without a back chevron is a drawer destination; on a phone its header opens the drawer.
	const drawer = getDrawer();
	const showBack = $derived(!!back && !(channelNavigation && drawer?.channels));
	const showMenu = $derived(!showBack && !!drawer && !drawer.persistent);
</script>

{#snippet leading()}
	{#if showBack && back}
		<Button
			href={back.href}
			onclick={back.onclick}
			variant="ghost"
			size="sm"
			class="-ms-1.5 px-1.5 text-muted-foreground"
		>
			<ChevronLeft aria-hidden="true" /><span class="sr-only @3xl:not-sr-only">{back.label}</span>
		</Button>
	{:else if showMenu && drawer}
		<Button
			variant="ghost"
			size="icon-sm"
			class="-ms-1 text-muted-foreground"
			aria-label={drawer.badge
				? `Menu, ${typeof drawer.badge === 'number' ? `${drawer.badge} need you` : 'something new'}`
				: 'Menu'}
			onclick={() => drawer.open()}
		>
			<Menu aria-hidden="true" />
			{#if drawer.badge}
				<span
					class="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-waiting"
					aria-hidden="true"
				></span>
			{/if}
		</Button>
	{/if}
{/snippet}

<PageHeader
	{title}
	{subtitle}
	{actions}
	leading={showBack || showMenu ? leading : undefined}
	leadingClass={showBack && back?.desktop === false ? '@3xl:hidden' : undefined}
/>
{#if toast && toastPosition === 'top'}
	<div class="shrink-0 px-3 pt-3 @3xl:px-6">
		<div
			role="status"
			class="flex items-center gap-3 rounded-xl bg-foreground px-4 py-3 text-sm [overflow-wrap:anywhere] text-background shadow-lg"
		>
			{@render toast()}
		</div>
	</div>
{/if}
{@render banner?.()}

<!-- column-reverse keeps a chat pinned to its newest message without scripting. -->
<main
	bind:this={scroller}
	class={cn(
		'@container min-h-0 flex-1 overflow-x-clip overscroll-contain',
		scrollable ? 'overflow-y-auto' : 'overflow-y-hidden',
		stickToBottom && 'flex flex-col-reverse'
	)}
>
	<div class={stickToBottom ? 'shrink-0' : 'h-full'}>{@render children()}</div>
</main>

<div
	class={cn(
		'relative shrink-0 bg-background pb-(--safe-bottom) @3xl:pb-0 kb:pb-0',
		measure && 'has-[[data-slot=screen-footer]>*]:border-t'
	)}
>
	{#if toast && toastPosition === 'bottom'}
		<div
			role="status"
			class="absolute inset-x-3 bottom-full mb-3 flex items-center gap-3 rounded-xl bg-foreground px-4 py-3 text-sm [overflow-wrap:anywhere] text-background shadow-lg @3xl:right-auto @3xl:left-6 @3xl:w-96"
		>
			{@render toast()}
		</div>
	{/if}
	{#if footer && measure}
		<!-- The bar owns the full-bleed border and the body's gutters, so children drop their own. -->
		<div
			data-slot="screen-footer"
			class={cn('px-4 *:border-t-0! *:px-0! md:px-6', measureClass[measure])}
		>
			{@render footer()}
		</div>
	{:else}
		{@render footer?.()}
	{/if}
</div>
