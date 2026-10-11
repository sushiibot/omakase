<script lang="ts">
	import { tasksStore } from './tasks.svelte';
	import TaskList from './task-list.svelte';
	import TaskDetail from './task-detail.svelte';
	import TaskChat from './task-chat.svelte';
	import TaskRuns from './task-runs.svelte';
	import { Button } from '$lib/ui/button';
	import Screen from '$lib/ui/screen/screen.svelte';
	import X from '@lucide/svelte/icons/x';
	import type { TaskRecord } from './types';
	let {
		conversationId,
		selectedId = $bindable<string | undefined>(),
		onclose,
		fullPage = false,
		onselect
	}: {
		conversationId?: string;
		selectedId?: string;
		onclose?: () => void;
		fullPage?: boolean;
		onselect?: (id: string) => void;
	} = $props();
	const store = tasksStore();
	const task = $derived(store.tasks.find((t) => t.id === selectedId));
	const visible = $derived(
		store.tasks.filter(
			(t) =>
				!conversationId ||
				t.sourceConversationId === conversationId ||
				t.workConversationId === conversationId
		)
	);
	async function update(
		patch: Partial<Pick<TaskRecord, 'title' | 'brief' | 'status' | 'checklist'>>
	) {
		return !!task && !!(await store.update(task, patch));
	}
</script>

{#if task}
	{#snippet conversation()}{#key task.id}<TaskChat {task} />{/key}{/snippet}
	{#snippet runs()}<TaskRuns ids={task.runIds} />{/snippet}
	{#key task.id}<TaskDetail
			{task}
			busy={store.busy}
			error={store.error}
			{conversation}
			{runs}
			fullHref={fullPage ? undefined : `/tasks/${task.id}`}
			onback={() => {
				selectedId = undefined;
				onclose && fullPage && onclose();
			}}
			onupdate={update}
			onstart={async (text) =>
				!!(await store.action({ action: 'start', id: task.id, ...(text ? { text } : {}) }))}
			onstop={() => void store.action({ action: 'stop', id: task.id })}
			onretry={() => void store.refresh(true)}
		/>{/key}
{:else}
	{#snippet taskList()}
		<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
			<TaskList
				tasks={visible}
				loading={store.loading}
				busy={store.busy}
				error={store.error}
				oncreate={async (title) =>
					!!(await store.action({
						action: 'create',
						title,
						conversationId: conversationId ?? 'main'
					}))}
				ontoggle={(task) =>
					void store.update(task, { status: task.status === 'done' ? 'todo' : 'done' })}
				onselect={(id) => {
					selectedId = id;
					onselect?.(id);
				}}
				onretry={() => void store.refresh(true)}
			/>
		</div>{/snippet}
	{#if fullPage}<Screen title="Tasks" scrollable={false}
			><div class="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
				{@render taskList()}
			</div></Screen
		>{:else}
		<header class="flex min-h-13 shrink-0 items-center gap-2 border-b px-4 py-1">
			<h1 class="flex-1 text-base font-semibold">Tasks</h1>
			{#if onclose}<Button
					variant="ghost"
					class="size-12 px-0"
					aria-label="Close tasks"
					onclick={onclose}><X /></Button
				>{/if}
		</header>
		{@render taskList()}
	{/if}
{/if}
