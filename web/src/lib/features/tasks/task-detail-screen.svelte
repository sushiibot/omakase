<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import ScreenState from '$lib/ui/screen/screen-state.svelte';
	import type { ScreenBack } from '$lib/ui/screen/context';
	import TaskDetail from './task-detail.svelte';
	import { taskLabels, type TaskRecord } from './types';
	let {
		task,
		loading,
		back,
		...detail
	}: Omit<ComponentProps<typeof TaskDetail>, 'task'> & {
		/** Undefined while loading, or when there is no such task. */
		task: TaskRecord | undefined;
		loading: boolean;
		back: ScreenBack;
	} = $props();
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
		{#key task.id}<TaskDetail {task} {...detail} />{/key}
	{:else}
		<ScreenContent>
			<ScreenState
				remote={{
					status: loading ? 'loading' : detail.error ? 'error' : 'ready',
					slow: true,
					error: detail.error
				}}
				errorTitle="Couldn't load this task."
				onretry={detail.onretry}
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
