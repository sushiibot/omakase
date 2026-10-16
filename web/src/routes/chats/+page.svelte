<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { leaveSheet, routedSheet } from '$lib/core/nav/sheet';
	import { offlineBrowsing } from '$lib/core/storage/offline.svelte';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import {
		BranchSheet,
		ChatsScreen,
		ThreadSettingsSheet,
		threadsStore,
		type ThreadSummary
	} from '$lib/features/threads';
	import { UndoToast } from '$lib/features/home';
	import { createInbox } from './inbox.svelte';
	import InboxDisclosure from './inbox-disclosure.svelte';
	import InboxSheet from './inbox-sheet.svelte';
	import NeedsYouSection from './needs-you-section.svelte';

	const threads = threadsStore();
	const inbox = createInbox();
	const list = threads.list;
	const sheet = routedSheet('branch');
	const settings = routedSheet('thread-settings');
	let selected = $state<ThreadSummary>();
	const picked = $derived(
		settings.arg === 'main' && list.data
			? {
					...list.data.main,
					id: 'main',
					title: list.data.main.title ?? 'Main',
					writes: 0
				}
			: (list.data?.threads.find((t) => t.id === settings.arg) ?? selected)
	);
	let query = $state('');
	let title = $state('');
	let now = $state(Date.now());

	onMount(() => {
		void list.ensure();
		const unwatch = list.watch();
		const t = setInterval(() => (now = Date.now()), 30_000);
		return () => {
			clearInterval(t);
			unwatch();
		};
	});

	async function start(name: string) {
		const id = await threads.branch('', name);
		if (!id) return;
		await leaveSheet(sheet);
		title = '';
		await goto(resolve('/chats/[id]', { id }));
	}
</script>

<svelte:head><title>Channels · sushii</title></svelte:head>

{#snippet inboxPanel()}<InboxDisclosure {inbox} />{/snippet}
{#snippet attention()}<NeedsYouSection {inbox} threads={list.data?.threads ?? []} />{/snippet}
{#snippet undo()}<UndoToast
		label={inbox.home.undoable?.label ?? ''}
		onundo={() => void inbox.home.undo()}
	/>{/snippet}

<ChatsScreen
	inbox={inboxPanel}
	{attention}
	notice={inbox.home.undoable ? undo : undefined}
	remote={list}
	data={list.data}
	{now}
	bind:query
	online={pwa.online && !offlineBrowsing.unreachable}
	updateReady={!!pwa.waiting}
	mainHref={resolve('/chat')}
	threadHref={(id) => resolve('/chats/[id]', { id })}
	onretry={() => void list.refetch()}
	onnew={() => {
		threads.clearError();
		sheet.openWith();
	}}
	onreload={() => pwa.reload()}
	onoptions={(thread) => {
		selected = thread;
		threads.clearError();
		settings.openWith(thread.id);
	}}
/>

<InboxSheet {inbox} threads={list.data?.threads ?? []} />

<BranchSheet
	open={sheet.open}
	bind:title
	busy={threads.busy}
	error={threads.error}
	onstart={(name) => void start(name)}
	onclose={() => sheet.close()}
/>

<ThreadSettingsSheet
	onopen={async (href) => {
		await leaveSheet(settings);
		await goto(href);
	}}
	open={settings.open}
	thread={picked}
	href={picked?.id === 'main' ? '/chat' : picked ? `/chats/${picked.id}` : undefined}
	onreopen={async () => {
		if (picked && (await threads.reopen(picked.id))) await leaveSheet(settings);
	}}
	busy={threads.busy}
	error={threads.error}
	onrename={async (title) => {
		if (picked && (await threads.rename(picked.id, title))) await leaveSheet(settings);
	}}
	onarchive={async () => {
		if (picked && (await threads.close(picked.id))) await leaveSheet(settings);
	}}
	onclose={() => settings.close()}
/>
