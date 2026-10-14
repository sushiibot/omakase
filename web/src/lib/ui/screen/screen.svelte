<!-- app: header, scrolling body, toast and footer for every screen (ux-guidelines.md#shared-component-patterns) -->
<script lang="ts">
	import type { ComponentProps, Snippet } from 'svelte';
	import { measureClass, type PageMeasure } from '$lib/ui/page';
	import { cn } from '$lib/utils';
	import { setScreenContext, type ScreenBack } from './context';
	import ScreenHeader from './screen-header.svelte';

	type HeaderProps = ComponentProps<typeof ScreenHeader>;

	let {
		title,
		subtitle,
		back,
		breadcrumb,
		level,
		media,
		headerClass,
		actions,
		banner,
		toast,
		toastPosition = 'bottom',
		footer,
		measure = 'reading',
		footerLayout = 'raw',
		stickToBottom = false,
		channelNavigation = false,
		scrollable = true,
		scroller = $bindable(null),
		children
	}: {
		title: string;
		subtitle?: Snippet;
		back?: ScreenBack;
		breadcrumb?: Snippet;
		level?: HeaderProps['level'];
		media?: Snippet;
		headerClass?: string;
		actions?: Snippet;
		/** Under the header, outside the scroll. */
		banner?: Snippet;
		/** A transient line above the footer, or below the header for chat. */
		toast?: Snippet;
		toastPosition?: 'top' | 'bottom';
		footer?: Snippet;
		/** The body's measure; ScreenContent and ScreenFooter inherit it. */
		measure?: PageMeasure;
		/** `page` lines toasts up with the body measure; `raw` keeps them at the screen edge, as chat does. ScreenFooter lays out the footer either way. */
		footerLayout?: 'page' | 'raw';
		/** Disable when the content owns its vertical scroll, such as a tab pager. */
		scrollable?: boolean;
		/** Keep the newest content in view, for chats. */
		stickToBottom?: boolean;
		channelNavigation?: boolean;
		/** The scrolling region, for callers that track the reader's position. */
		scroller?: HTMLElement | null;
		children: Snippet;
	} = $props();

	setScreenContext({
		get measure() {
			return measure;
		}
	});
	// Page layouts line toasts up with the body, like the footer.
	const pageFrame = $derived(
		footerLayout === 'page' ? cn('px-4 md:px-6', measureClass[measure]) : undefined
	);
</script>

<ScreenHeader
	{title}
	{subtitle}
	{back}
	{channelNavigation}
	{breadcrumb}
	{level}
	{media}
	{actions}
	class={headerClass}
/>
{#snippet toastBox(className?: string)}
	<div
		role="status"
		class={cn(
			'flex items-center gap-3 rounded-xl bg-foreground px-4 py-3 text-sm [overflow-wrap:anywhere] text-background shadow-lg',
			className
		)}
	>
		{@render toast?.()}
	</div>
{/snippet}

{#if toast && toastPosition === 'top'}
	<div class={pageFrame ? cn('shrink-0 pt-3', pageFrame) : 'shrink-0 px-3 pt-3 @3xl:px-6'}>
		{@render toastBox()}
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

<div class="relative shrink-0 bg-background pb-(--safe-bottom) @3xl:pb-0 kb:pb-0">
	{#if toast && toastPosition === 'bottom'}
		{#if pageFrame}
			<div class="pointer-events-none absolute inset-x-0 bottom-full mb-3">
				<div class={pageFrame}>{@render toastBox('pointer-events-auto md:w-96')}</div>
			</div>
		{:else}
			{@render toastBox(
				'absolute inset-x-3 bottom-full mb-3 @3xl:right-auto @3xl:left-6 @3xl:w-96'
			)}
		{/if}
	{/if}
	{@render footer?.()}
</div>
