<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { TaskPanel, TaskWorkspace, TaskChat, tasksStore } from '$lib/features/tasks';
	import { routedSheet } from '$lib/core/nav/sheet';
	import { Button } from '$lib/ui/button';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	const taskPane = routedSheet('tasks');
	const store = tasksStore();
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
			conversationId={task.workConversationId!}
			initialSelectedId={task.id}
			open={taskPane.open}
			onopen={() => taskPane.openWith()}
			onclose={() => taskPane.close()}
		>
			{#snippet children(toggle: () => void)}
				{#snippet actions()}<Button
						variant="ghost"
						class="size-12 px-0"
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
				/>
			{/snippet}
		</TaskWorkspace>{/key}
{:else}<TaskPanel {selectedId} fullPage onclose={() => void goto(resolve('/tasks'))} />{/if}
