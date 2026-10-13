<script lang="ts">
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import ScreenState from '$lib/ui/screen/screen-state.svelte';
	import type { ScreenBack } from '$lib/ui/screen/context';
	import TaskChat from './task-chat.svelte';
	import TaskDetail from './task-detail.svelte';
	import TaskRuns from './task-runs.svelte';
	import { tasksStore } from './tasks.svelte';
	import { taskLabels, type TaskRecord } from './types';
	let { id, back }: { id: string; back: ScreenBack } = $props();
	const store = tasksStore();
	const task = $derived(store.tasks.find((t) => t.id === id));
	async function update(
		patch: Partial<Pick<TaskRecord, 'title' | 'brief' | 'status' | 'checklist'>>
	) {
		return !!task && !!(await store.update(task, patch));
	}
</script>

{#snippet subtitle()}{#if task}{taskLabels[task.status]}{task.agent
			? ` · ${task.agent}`
			: ''}{/if}{/snippet}

<DetailScreen
	title={task?.title ?? 'Task'}
	subtitle={task ? subtitle : undefined}
	{back}
	scrollable={!task}
>
	{#if task}
		{#snippet runs()}<TaskRuns ids={task.runIds} />{/snippet}
		{#snippet conversation(viewing: boolean)}{#key task.id}<TaskChat
					{task}
					{viewing}
				/>{/key}{/snippet}
		{#key task.id}<TaskDetail
				{task}
				busy={store.busy}
				error={store.error}
				{conversation}
				{runs}
				onupdate={update}
				onstart={async (text) =>
					!!(await store.action({ action: 'start', id: task.id, ...(text ? { text } : {}) }))}
				onstop={() => void store.action({ action: 'stop', id: task.id })}
				onretry={() => void store.refresh(true)}
			/>{/key}
	{:else}
		<ScreenContent>
			<ScreenState
				remote={{
					status: store.loading ? 'loading' : store.error ? 'error' : 'ready',
					slow: true,
					error: store.error
				}}
				errorTitle="Couldn't load this task."
				onretry={() => void store.refresh(true)}
				isEmpty
				empty={{
					title: 'Task not found',
					body: 'It may have been removed, or the link is wrong.'
				}}
			>
				{#snippet children()}{/snippet}
			</ScreenState>
		</ScreenContent>
	{/if}
</DetailScreen>
