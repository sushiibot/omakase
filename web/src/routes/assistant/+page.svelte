<script lang="ts">
	import { MaintenanceSummary, maintenanceStore } from '$lib/features/maintenance';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import SplitScreen from '$lib/ui/screen/split-screen.svelte';
	import { onMount } from 'svelte';
	import { Remote } from '$lib/core/remote.svelte';
	import { AssistantScreen, continueItems } from '$lib/features/assistant';
	import { artifactsApi, artifactVisits } from '$lib/features/artifacts';
	import { channelsStore } from '$lib/features/channels';
	import { tasksStore } from '$lib/features/tasks';
	import { threadsStore } from '$lib/features/threads';
	import { UndoToast } from '$lib/features/home';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import { createInbox } from '../chats/inbox.svelte';
	import InboxSheet from '../chats/inbox-sheet.svelte';

	const tab = $derived(
		['following', 'watching', 'history'].includes(page.url.searchParams.get('view') ?? '')
			? page.url.searchParams.get('view')!
			: 'overview'
	);
	const maintenance = maintenanceStore();
	const inbox = createInbox('/assistant');
	const channels = channelsStore();
	const tasks = tasksStore();
	const threads = threadsStore();
	const visits = artifactVisits();
	const documents = new Remote(() => artifactsApi.list(), { refetchOnFocus: true });
	const recent = $derived(
		continueItems(
			channels.list.data?.channels ?? [],
			channels.recentIds,
			documents.data?.artifacts ?? [],
			visits.ids
		)
	);
	const notices = $derived.by(() => {
		const result: { label: string; retry: () => void }[] = [];
		if (maintenance.remote.error)
			result.push({
				label: 'Couldn’t load calendar maintenance.',
				retry: () => void maintenance.remote.refetch()
			});
		if (documents.error)
			result.push({ label: "Couldn't load documents.", retry: () => void documents.refetch() });
		if (documents.data?.truncated)
			result.push({
				label: 'The document list is limited. Search the library to find older documents.',
				retry: () => void documents.refetch()
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
		void documents.ensure();
		void maintenance.remote.refetch();
		void threads.list.ensure();
		const stops = [
			maintenance.remote.watch(),
			documents.watch(),
			channels.watch(),
			tasks.watch(),
			threads.list.watch()
		];
		const timer = setInterval(() => {
			if (!document.hidden && !maintenance.busy) void maintenance.remote.refetch();
			if (!document.hidden && documents.status !== 'loading') void documents.refetch();
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
		bind:tab={
			() => tab,
			(view) => {
				const url = new URL(page.url);
				if (view === 'overview') url.searchParams.delete('view');
				else url.searchParams.set('view', view);
				void goto(url, { replaceState: true, noScroll: true, keepFocus: true, state: page.state });
			}
		}
		maintenanceCount={maintenance.remote.data?.view.proposals.filter((p) =>
			['pending', 'uncertain', 'executing', 'undoing'].includes(p.status)
		).length ?? 0}
		{maintenanceAttention}
		{maintenanceUpdates}
		{maintenanceWatching}
		groups={inbox.home.groups}
		tasks={tasks.tasks}
		documents={documents.data?.artifacts ?? []}
		{recent}
		channels={channels.list.data?.channels ?? []}
		now={inbox.now}
		selected={inbox.peek?.id}
		{notices}
		loading={inbox.remote.status === 'loading' ||
			(tasks.loading && !tasks.tasks.length) ||
			((documents.status === 'idle' || documents.status === 'loading') && !documents.data)}
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
