<script lang="ts">
	import '../app.css';
	import { deviceFs } from '$lib/core/native/device-fs.svelte';
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { features } from '$lib/core/features.svelte';
	import { restorePageScroll } from '$lib/core/nav/scroll';
	import { previousPathIs } from '$lib/core/nav/back';
	import { activeNav, navFor } from '$lib/core/nav/nav';
	import { isSettingsPath, settingsGroups } from '$lib/core/nav/settings';
	import SettingsNavigation from '$lib/ui/shell/settings-navigation.svelte';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import { markBooted } from '$lib/core/pwa/boot-recovery';
	import { hub } from '$lib/core/realtime/hub.svelte';
	import { send } from '$lib/core/http';
	import {
		BranchSheet,
		ThreadSettingsSheet,
		threadsStore,
		type ThreadSummary
	} from '$lib/features/threads';
	import {
		ChannelNavigation,
		channelsStore,
		type Channel,
		type ChannelView
	} from '$lib/features/channels';
	import { routedSheet, leaveSheet } from '$lib/core/nav/sheet';
	import { goto } from '$app/navigation';
	import { needsYou } from '$lib/features/home';
	import AppUpdates from '$lib/ui/pwa/app-updates.svelte';
	import { androidUpdates } from '$lib/core/native/updates.svelte';
	import Shell from '$lib/ui/shell/shell.svelte';

	let { children } = $props();

	restorePageScroll();

	// Before any route renders, so a cold deep link to any screen has live data.
	hub.start();
	// Listens from the start, so the inbox badge counts what waits whatever screen is open.
	const catalog = channelsStore();
	const navigation = routedSheet('channels');
	const createChannel = routedSheet('channel-create');
	let channelTitle = $state('');
	let query = $state('');
	let view = $state<ChannelView>('all');
	let closedGroups = $state<Record<string, boolean>>({ archived: true });
	let filtersOpen = $state(false);
	const channelSettings = routedSheet('channel-settings');
	let selectedChannel = $state<Channel>();
	const currentSelected = $derived(
		catalog.list.data?.channels.find((channel) => channel.id === selectedChannel?.id) ??
			selectedChannel
	);
	const selectedSummary = $derived(
		currentSelected
			? ({
					id: currentSelected.id,
					title: currentSelected.title,
					state: currentSelected.state,
					preview: currentSelected.preview,
					writes: 0,
					lastActivity: currentSelected.lastActivity ?? new Date().toISOString()
				} as ThreadSummary)
			: undefined
	);
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
	const settingsMode = $derived(isSettingsPath(page.url.pathname));
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
	$effect(() => {
		const id = currentId;
		const sequence =
			catalog.list.data?.channels.find((channel) => channel.id === id)?.lastMessageSeq ?? null;
		if (!id) return;
		if (
			page.url.pathname.startsWith('/tasks/') &&
			page.url.searchParams.get('view') !== 'conversation'
		)
			return;
		const read = () => {
			if (document.visibilityState === 'visible') untrack(() => catalog.markRead(id, sequence));
		};
		read();
		document.addEventListener('visibilitychange', read);
		return () => document.removeEventListener('visibilitychange', read);
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
		void deviceFs.start();
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
		notice={updateNotice}
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
		navigation={settingsMode ? settingsNavigation : channelNavigation}
		{settingsMode}
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
		channels={catalog.visible(view, { search: query, includeArchived: true })}
		selected={currentId}
		bind:query
		bind:view
		bind:closed={closedGroups}
		bind:filtersOpen
		loading={catalog.list.status === 'loading'}
		error={catalog.list.error}
		replacing={navigation.open}
		onoptions={(channel) => {
			selectedChannel = channel;
			threadsStore().clearError();
			channelSettings.openWith(channel.id);
		}}
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

<ThreadSettingsSheet
	onopen={async (href) => {
		await leaveSheet(channelSettings);
		await goto(href);
	}}
	open={channelSettings.open}
	thread={selectedSummary}
	href={currentSelected?.kind === 'main'
		? '/chat'
		: currentSelected?.kind === 'task'
			? `/tasks/${currentSelected.taskId}?view=conversation`
			: currentSelected
				? `/chats/${currentSelected.id}`
				: undefined}
	busy={threadsStore().busy}
	error={threadsStore().error}
	onrename={async (title) => {
		if (currentSelected && (await threadsStore().rename(currentSelected.id, title))) {
			await catalog.list.refetch();
			await leaveSheet(channelSettings);
		}
	}}
	onarchive={async () => {
		if (currentSelected && (await threadsStore().close(currentSelected.id))) {
			await catalog.list.refetch();
			await leaveSheet(channelSettings);
		}
	}}
	onreopen={async () => {
		if (currentSelected && (await threadsStore().reopen(currentSelected.id))) {
			await catalog.list.refetch();
			await leaveSheet(channelSettings);
		}
	}}
	onclose={() => channelSettings.close()}
/>

{#snippet updateNotice()}
	<AppUpdates
		webState={pwa.updateState}
		webError={pwa.updateError}
		androidVersion={androidUpdates.available ? androidUpdates.release?.versionName : undefined}
		androidUrl={androidUpdates.release?.url}
		androidSupported={androidUpdates.supported}
		androidBusy={androidUpdates.busy}
		androidError={androidUpdates.error}
		permissionRequired={androidUpdates.permissionRequired}
		onreload={() => pwa.reload()}
		onretry={() => void pwa.prepareUpdate()}
		oninstall={() => void androidUpdates.install()}
	/>
{/snippet}

{#snippet settingsNavigation()}
	<SettingsNavigation groups={settingsGroups} path={page.url.pathname} compact />
{/snippet}
