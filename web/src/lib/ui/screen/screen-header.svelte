<!-- Page.Header with the phone drawer button or back link, for headers outside a Screen -->
<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import Menu from '@lucide/svelte/icons/menu';
	import { Button } from '$lib/ui/button';
	import { PageHeader } from '$lib/ui/page';
	import { getDrawer } from '../shell/drawer';
	import type { ScreenBack } from './context';

	let {
		back,
		channelNavigation = false,
		...headerProps
	}: Omit<ComponentProps<typeof PageHeader>, 'leading'> & {
		back?: ScreenBack;
		/** The channel drawer replaces the back link. */
		channelNavigation?: boolean;
	} = $props();

	// A screen without a back chevron is a drawer destination; on a phone its header opens the drawer.
	const drawer = getDrawer();
	const showBack = $derived(
		!!back &&
			!(channelNavigation && drawer?.channels) &&
			!(back.desktop === false && drawer?.persistent)
	);
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

<PageHeader {...headerProps} leading={showBack || showMenu ? leading : undefined} />
