<script lang="ts">
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import TaskList from './task-list.svelte';
	import { tasksStore } from './tasks.svelte';
	let { onselect }: { onselect: (id: string) => void } = $props();
	const store = tasksStore();
</script>

<DetailScreen title="Tasks">
	<ScreenContent>
		<TaskList
			tasks={store.tasks}
			loading={store.loading}
			busy={store.busy}
			error={store.error}
			oncreate={async (title) =>
				!!(await store.action({ action: 'create', title, conversationId: 'main' }))}
			ontoggle={(task) =>
				void store.update(task, { status: task.status === 'done' ? 'todo' : 'done' })}
			{onselect}
			onretry={() => void store.refresh(true)}
		/>
	</ScreenContent>
</DetailScreen>
