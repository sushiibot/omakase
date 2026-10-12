<script lang="ts">
	import '../app.css';
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { features } from '$lib/core/features.svelte';
	import { previousPathIs } from '$lib/core/nav/back';
	import { activeNav, navFor } from '$lib/core/nav/nav';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import { markBooted } from '$lib/core/pwa/boot-recovery';
	import { hub } from '$lib/core/realtime/hub.svelte';
	import { send } from '$lib/core/http';
	import { BranchSheet, threadsStore } from '$lib/features/threads';
	import { ChannelNavigation, channelsStore, type ChannelView } from '$lib/features/channels';
	import { routedSheet, leaveSheet } from '$lib/core/nav/sheet';
	import { goto } from '$app/navigation';
	import { needsYou } from '$lib/features/home';
	import Shell from '$lib/ui/shell/shell.svelte';

	let { children } = $props();

	// Before any route renders, so a cold deep link to any screen has live data.
	hub.start();
	// Listens from the start, so the inbox badge counts what waits whatever screen is open.
	const catalog = channelsStore();
	const navigation = routedSheet('channels');
	const createChannel = routedSheet('channel-create');
	let channelTitle = $state('');
	let query = $state('');
	let view = $state<ChannelView>('all');
	let includeArchived = $state(false);
	let pendingNavigation = $state<string | null>(null);
	async function navigateFromSidebar(href: string) {
		pendingNavigation = href;
		try {
			await leaveSheet(navigation);
			await goto(href);
		} finally {
			pendingNavigation = null;
		}
	}
	const channelRoute = $derived(
		page.url.pathname === '/chat' ||
			/^\/chats\/[^/]+$/.test(page.url.pathname) ||
			/^\/tasks\/[^/]+$/.test(page.url.pathname)
	);
	const currentId = $derived(
		page.url.pathname === '/chat'
			? 'main'
			: page.url.pathname.startsWith('/chats/')
				? page.params.id
				: page.url.pathname.startsWith('/tasks/')
					? catalog.list.data?.channels.find((c) => c.taskId === page.params.id)?.id
					: undefined
	);
	$effect(() => {
		const id = currentId;
		if (id) untrack(() => catalog.visit(id));
	});
	async function startChannel(title: string) {
		const id = await threadsStore().branch('', title);
		if (!id) return;
		await leaveSheet(createChannel);
		channelTitle = '';
		void catalog.list.refetch();
		await goto(`/chats/${encodeURIComponent(id)}`);
	}
	const home = needsYou();
	home.start();

	onMount(() => {
		markBooted();
		pwa.start();
		void threadsStore().list.ensure();
		if (page.url.pathname !== '/chat') {
			void send('GET', '/chat/history?limit=40').catch(() => {});
		}
		const stopCatalog = catalog.watch();
		const stopFeatures = features.start();
		return () => {
			stopCatalog();
			stopFeatures?.();
		};
	});
</script>

<svelte:head
	><link rel="icon" href="/icons/favicon-32.png" type="image/png" sizes="32x32" /></svelte:head
>

<div class="h-dvh">
	<Shell
		nav={navFor(features.has)}
		active={activeNav(page.route.id)}
		navigationKey={page.url.pathname + page.url.search}
		home="chats"
		conversation={channelRoute}
		navigationOpen={navigation.open || pendingNavigation !== null}
		onopenNavigation={() => navigation.openWith()}
		oncloseNavigation={() => {
			if (pendingNavigation === null) navigation.close();
		}}
		onnavigate={(href) => void navigateFromSidebar(href)}
		navigation={channelNavigation}
		badges={{
			chats:
				catalog.list.data?.channels.reduce((total, channel) => total + channel.pending.total, 0) ??
				home.waitingCount
		}}
		onhome={(e) => {
			// Back to the conversations entry already under this one, rather than stacking a second.
			if (!previousPathIs('/chats')) return;
			e.preventDefault();
			history.back();
		}}>{@render children()}</Shell
	>
</div>

{#snippet channelNavigation()}
	<ChannelNavigation
		channels={catalog.visible(view, { search: query, includeArchived })}
		selected={currentId}
		bind:query
		bind:view
		bind:includeArchived
		loading={catalog.list.status === 'loading'}
		error={catalog.list.error}
		replacing={navigation.open}
		onvisit={(id) => catalog.visit(id)}
		onretry={() => void catalog.list.refetch()}
		onnew={() => {
			threadsStore().clearError();
			channelTitle = '';
			createChannel.openWith();
		}}
	/>
{/snippet}
<BranchSheet
	open={createChannel.open}
	bind:title={channelTitle}
	busy={threadsStore().busy}
	error={threadsStore().error}
	onstart={(name) => void startChannel(name)}
	onclose={() => createChannel.close()}
/>
