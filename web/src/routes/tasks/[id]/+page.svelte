<script lang="ts">
	import { INSPECTOR_BREAKPOINT } from '$lib/ui/breakpoints';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		TaskDetailScreen,
		TaskWorkspace,
		TaskChat,
		TaskRuns,
		tasksStore,
		type TaskRecord,
		type PanelTab
	} from '$lib/features/tasks';
	import { backTo } from '$lib/core/nav/back';
	import { routedSheet } from '$lib/core/nav/sheet';
	import { leaveMessageLink } from '$lib/core/nav/message-link';
	import { linkTarget } from '$lib/features/chat';
	import { getWorkspace } from '$lib/ui/workspace/context';
	import { followAgentLink, openAgentFrom, openAgentPage } from '$lib/core/nav/agent-link';
	import { untrack } from 'svelte';
	import { Button } from '$lib/ui/button';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	const taskPane = routedSheet('tasks');
	const workspaceLayout = getWorkspace();
	const docked = () =>
		workspaceLayout?.docked ?? matchMedia(`(min-width: ${INSPECTOR_BREAKPOINT}px)`).matches;
	let panelTab = $state<PanelTab>('tasks');
	let panelAgent = $state<string | undefined>();
	function showAgent(id: string) {
		panelTab = 'agents';
		panelAgent = id;
	}
	$effect(() => {
		if (!page.url.searchParams.has('agent')) return;
		untrack(() => followAgentLink({ docked, sheet: taskPane, openPanel: showAgent }));
	});
	const store = tasksStore();
	const goBack = backTo(resolve('/tasks'));
	let selectedId = $derived(page.params.id);
	const task = $derived(store.tasks.find((task) => task.id === selectedId));
	const channel = $derived(
		page.url.searchParams.get('view') === 'conversation' && !!task?.workConversationId
	);
	onMount(() => store.watch());
</script>

<svelte:head
	><title>{store.tasks.find((t) => t.id === selectedId)?.title ?? 'Task'} · sushii</title
	></svelte:head
>
{#if channel && task}
	{#key task.id}<TaskWorkspace
			conversationId={task?.workConversationId ?? ''}
			initialSelectedId={task.id}
			open={taskPane.open}
			bind:tab={panelTab}
			bind:agentId={panelAgent}
			onopen={() => taskPane.openWith()}
			onclose={() => taskPane.close()}
			onnavigate={(href) => void openAgentPage(href, taskPane)}
		>
			{#snippet children(toggle: () => void)}
				{#snippet actions()}<Button
						size="icon"
						variant="ghost"
						aria-label="Task details"
						aria-expanded={taskPane.open}
						onclick={toggle}><ListChecks class="size-5" /></Button
					>{/snippet}
				<TaskChat
					{task}
					headerActions={actions}
					link={linkTarget(page.url.searchParams)}
					onleavelink={leaveMessageLink}
					onopenagent={(agent, event) =>
						openAgentFrom(event, agent.id, {
							docked: docked(),
							sheet: taskPane,
							showInPanel: showAgent
						})}
				/>
			{/snippet}
		</TaskWorkspace>{/key}
{:else}
	{#snippet runs()}{#if task}<TaskRuns ids={task.runIds} />{/if}{/snippet}
	{#snippet conversation(viewing: boolean)}{#if task}{#key task.id}<TaskChat
					{task}
					{viewing}
				/>{/key}{/if}{/snippet}
	<TaskDetailScreen
		{task}
		loading={store.loading}
		busy={store.busy}
		error={store.error}
		back={{ href: resolve('/tasks'), label: 'Tasks', onclick: goBack }}
		{conversation}
		{runs}
		onupdate={async (patch) => !!task && !!(await store.update(task, patch))}
		onstart={async (text) =>
			!!task && !!(await store.action({ action: 'start', id: task.id, ...(text ? { text } : {}) }))}
		onstop={() => task && void store.action({ action: 'stop', id: task.id })}
		onretry={() => void store.refresh(true)}
	/>{/if}
