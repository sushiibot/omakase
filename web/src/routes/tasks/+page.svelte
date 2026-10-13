<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { TaskListScreen, tasksStore } from '$lib/features/tasks';
	const store = tasksStore();
	onMount(() => store.watch());
</script>

<svelte:head><title>Tasks · sushii</title></svelte:head>
<TaskListScreen
	tasks={store.tasks}
	loading={store.loading}
	busy={store.busy}
	error={store.error}
	oncreate={async (title) =>
		!!(await store.action({ action: 'create', title, conversationId: 'main' }))}
	ontoggle={(task) => void store.update(task, { status: task.status === 'done' ? 'todo' : 'done' })}
	onselect={(id) => void goto(resolve('/tasks/[id]', { id }))}
	onretry={() => void store.refresh(true)}
/>
