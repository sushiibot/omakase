<!-- Page.Header with the phone drawer button or back link, for headers outside a Screen -->
<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import Menu from '@lucide/svelte/icons/menu';
	import { Button } from '$lib/ui/button';
	import { cn } from '$lib/utils';
	import { PageHeader } from '$lib/ui/page';
	import { Trigger as SidebarTrigger } from '$lib/ui/sidebar';
	import { getDrawer } from '../shell/drawer';
	import type { ScreenBack } from './context';

	let {
		back,
		channelNavigation = false,
		...headerProps
	}: Omit<ComponentProps<typeof PageHeader>, 'leading' | 'leadingClass'> & {
		back?: ScreenBack;
		/** The channel drawer replaces the back link. */
		channelNavigation?: boolean;
	} = $props();

	// A screen without a back chevron is a drawer destination; on a phone its header opens the drawer.
	// From 768 the header always leads with the sidebar trigger, as in sidebar-15.
	const drawer = getDrawer();
	const showBack = $derived(
		!!back &&
			!(channelNavigation && drawer?.channels) &&
			!(back.desktop === false && drawer?.persistent)
	);
	const showTrigger = $derived(!!drawer?.docked);
	const showMenu = $derived(!showBack && !!drawer && !drawer.docked);
</script>

{#snippet leading()}
	{#if showTrigger && drawer}
		<span class="relative flex">
			<SidebarTrigger class="-ms-1 text-muted-foreground" />
			{#if drawer.badge && !drawer.persistent}
				<span
					class="pointer-events-none absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-waiting"
					aria-hidden="true"
				></span>
			{/if}
		</span>
	{/if}
	{#if showBack && back}
		<Button
			href={back.href}
			onclick={back.onclick}
			variant="ghost"
			size="sm"
			class={cn(
				'px-1.5 text-muted-foreground',
				showTrigger ? headerProps.breadcrumb && 'md:hidden' : '-ms-1.5'
			)}
		>
			<ChevronLeft class="size-4" aria-hidden="true" /><span class="sr-only md:not-sr-only"
				>{back.label}</span
			>
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
	{...headerProps}
	leading={showTrigger || showBack || showMenu ? leading : undefined}
	leadingClass={!showTrigger && showBack && headerProps.breadcrumb ? 'md:hidden' : undefined}
/>
