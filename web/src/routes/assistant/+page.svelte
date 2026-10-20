<script lang="ts">
	import { MaintenanceSummary, maintenanceStore } from '$lib/features/maintenance';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import SplitScreen from '$lib/ui/screen/split-screen.svelte';
	import { onMount } from 'svelte';
	import { AssistantScreen, recentConversations } from '$lib/features/assistant';
	import { chatStore } from '$lib/features/chat';
	import { channelsStore } from '$lib/features/channels';
	import { tasksStore } from '$lib/features/tasks';
	import { threadsStore } from '$lib/features/threads';
	import { UndoToast } from '$lib/features/home';
	import { conversationTitle, inUse, SavedInUse, savedStore } from '$lib/features/saved';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import { createInbox } from '../chats/inbox.svelte';
	import InboxSheet from '../chats/inbox-sheet.svelte';

	// The quick ask keeps its own draft for this tab, so Main's draft, photos and reference stay put.
	const ASK_KEY = 'home:ask:v1';
	let ask = $state(readAsk());
	function readAsk() {
		try {
			return sessionStorage.getItem(ASK_KEY) ?? '';
		} catch {
			return '';
		}
	}
	$effect(() => {
		try {
			if (ask) sessionStorage.setItem(ASK_KEY, ask);
			else sessionStorage.removeItem(ASK_KEY);
		} catch {
			/* The draft lasts for this visit only. */
		}
	});
	/** Sends to Main as the owner's message, then opens Main, where the bubble already shows. */
	function sendAsk() {
		const text = ask.trim();
		if (!text) return;
		const main = chatStore();
		void main.send(text, [], { preserveComposer: true });
		ask = '';
		void goto(resolve('/chat'));
	}
	const maintenance = maintenanceStore();
	const inbox = createInbox('/assistant');
	const channels = channelsStore();
	const tasks = tasksStore();
	const threads = threadsStore();
	const recent = $derived(recentConversations(channels.visible('all'), channels.recentIds));
	const saved = savedStore();
	const using = $derived(inUse(saved.items, inbox.now));
	const notices = $derived.by(() => {
		const result: { label: string; retry: () => void }[] = [];
		if (maintenance.remote.error)
			result.push({
				label: 'Couldn’t load calendar maintenance.',
				retry: () => void maintenance.remote.refetch()
			});
		if (tasks.error)
			result.push({ label: "Couldn't refresh tasks.", retry: () => void tasks.refresh(true) });
		if (channels.list.error)
			result.push({
				label: "Couldn't refresh conversations.",
				retry: () => void channels.list.refetch()
			});
		if (inbox.data.error || (inbox.data.data && inbox.data.data.workspace.state !== 'online'))
			result.push({
				label: 'Some agent activity is unavailable.',
				retry: () => void inbox.data.refetch()
			});
		return result;
	});
	onMount(() => {
		void maintenance.remote.refetch();
		void threads.list.ensure();
		void saved.all.ensure();
		const stops = [
			saved.all.watch(),
			maintenance.remote.watch(),
			channels.watch(),
			tasks.watch(),
			threads.list.watch()
		];
		const timer = setInterval(() => {
			if (!document.hidden && !maintenance.busy) void maintenance.remote.refetch();
		}, 30_000);
		return () => {
			stops.forEach((stop) => stop());
			clearInterval(timer);
		};
	});
</script>

<svelte:head><title>Home · sushii</title></svelte:head>
{#snippet banner()}{#if inbox.connection}<ConnectionBanner
			state={inbox.connection}
		/>{/if}{/snippet}
{#snippet toast()}<UndoToast
		label={inbox.home.undoable?.label ?? ''}
		onundo={() => void inbox.home.undo()}
	/>{/snippet}
<SplitScreen>
	<AssistantScreen
		bind:ask
		onask={sendAsk}
		maintenanceCount={maintenance.remote.data?.view.proposals.filter((p) =>
			['pending', 'uncertain', 'executing', 'undoing'].includes(p.status)
		).length ?? 0}
		{maintenanceAttention}
		{maintenanceUpdates}
		{maintenanceWatching}
		inUse={inUseSection}
		inUseCount={using.length}
		groups={inbox.home.groups}
		tasks={tasks.tasks}
		{recent}
		channels={channels.list.data?.channels ?? []}
		now={inbox.now}
		selected={inbox.peek?.id}
		{notices}
		loading={inbox.remote.status === 'loading' || (tasks.loading && !tasks.tasks.length)}
		onopen={(id) => {
			inbox.home.clearResult(id);
			inbox.sheet.openWith(id);
		}}
		{banner}
		toast={inbox.home.undoable ? toast : undefined}
	/>
	{#snippet review()}<InboxSheet
			{inbox}
			threads={threads.list.data?.threads ?? []}
			inspector
		/>{/snippet}
</SplitScreen>

{#snippet inUseSection()}<SavedInUse
		items={using}
		now={inbox.now}
		titleOf={(id) => conversationTitle(id, channels.list.data?.channels ?? [])}
	/>{/snippet}
{#snippet maintenanceAttention()}<MaintenanceSummary
		mode="needs"
		view={maintenance.remote.data?.view}
		onpause={() => {}}
	/>{/snippet}
{#snippet maintenanceUpdates()}<MaintenanceSummary
		mode="updates"
		view={maintenance.remote.data?.view}
		onpause={() => {}}
	/>{/snippet}
{#snippet maintenanceWatching()}<MaintenanceSummary
		mode="watching"
		view={maintenance.remote.data?.view}
		busy={maintenance.busy}
		error={maintenance.error}
		onpause={(paused) => void maintenance.act({ action: 'pause', paused })}
	/>{/snippet}
