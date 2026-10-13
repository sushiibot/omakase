<script lang="ts">
	import { INSPECTOR_BREAKPOINT } from '$lib/ui/breakpoints';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { TaskDetailScreen, TaskWorkspace, TaskChat, tasksStore } from '$lib/features/tasks';
	import { backTo } from '$lib/core/nav/back';
	import { routedSheet } from '$lib/core/nav/sheet';
	import { getWorkspace } from '$lib/ui/workspace/context';
	import { followAgentLink, openAgentFrom, openAgentPage } from '$lib/core/nav/agent-link';
	import { untrack } from 'svelte';
	import { Button } from '$lib/ui/button';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	const taskPane = routedSheet('tasks');
	const workspaceLayout = getWorkspace();
	const docked = () =>
		workspaceLayout?.docked ?? matchMedia(`(min-width: ${INSPECTOR_BREAKPOINT}px)`).matches;
	let panelTab = $state<'tasks' | 'agents'>('tasks');
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
					focusTurn={page.url.searchParams.get('turn') ?? undefined}
					focusAsk={page.url.searchParams.get('ask') ?? undefined}
					focusApproval={page.url.searchParams.get('approve') ?? undefined}
					onopenagent={(agent, event) =>
						openAgentFrom(event, agent.id, {
							docked: docked(),
							sheet: taskPane,
							showInPanel: showAgent
						})}
				/>
			{/snippet}
		</TaskWorkspace>{/key}
{:else}<TaskDetailScreen
		id={selectedId ?? ''}
		back={{ href: resolve('/tasks'), label: 'Tasks', onclick: goBack }}
	/>{/if}
