<script lang="ts">
	import { tasksStore } from './tasks.svelte';
	import TaskList from './task-list.svelte';
	import TaskInspector from './task-inspector.svelte';
	import TaskRuns from './task-runs.svelte';
	import { Button } from '$lib/ui/button';
	import X from '@lucide/svelte/icons/x';
	import * as Tabs from '$lib/ui/tabs';
	import { Badge } from '$lib/ui/badge';
	import { AgentsPanel, agentList } from '$lib/features/agents';
	import { SavedPanel } from '$lib/features/saved';
	import type { PanelTab, TaskRecord } from './types';
	let {
		conversationId,
		selectedId = $bindable<string | undefined>(),
		onclose,
		tab = $bindable<PanelTab>('tasks'),
		agentId = $bindable<string | undefined>(),
		docked = true,
		onnavigate
	}: {
		conversationId?: string;
		selectedId?: string;
		onclose?: () => void;
		/** The side panel's tab: this conversation's tasks, its coding agents, or its saved items. */
		tab?: PanelTab;
		/** The agent open in the docked panel. */
		agentId?: string;
		docked?: boolean;
		/** Leaves the panel for a page, such as an agent's on phones. */
		onnavigate?: (href: string) => void;
	} = $props();
	const agents = $derived(conversationId === '' ? null : agentList(conversationId ?? 'main'));
	$effect(() => agents?.watch());
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

{#snippet taskList()}
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<TaskList
			class="p-4"
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
			onselect={(id) => (selectedId = id)}
			onretry={() => void store.refresh(true)}
		/>
	</div>{/snippet}
{#snippet inspector(task: TaskRecord)}
	{#snippet runs()}<TaskRuns ids={task.runIds} />{/snippet}
	{#key task.id}<TaskInspector
			{task}
			busy={store.busy}
			error={store.error}
			fullHref={`/tasks/${task.id}?view=conversation`}
			{runs}
			onback={() => (selectedId = undefined)}
			onupdate={update}
			onstart={async (text) =>
				!!(await store.action({ action: 'start', id: task.id, ...(text ? { text } : {}) }))}
			onstop={() => void store.action({ action: 'stop', id: task.id })}
			onretry={() => void store.refresh(true)}
		/>{/key}
{/snippet}

<Tabs.Root bind:value={tab} class="min-h-0 flex-1 gap-0">
	<div class="flex h-(--header-height) shrink-0 items-center gap-2 border-b px-4 lg:px-6">
		<Tabs.List
			variant="line"
			aria-label="Side panel"
			class="-ms-1.5 any-pointer-coarse:group-data-horizontal/tabs:h-auto"
		>
			{#each [{ value: 'tasks', label: 'Tasks' }, { value: 'agents', label: 'Agents' }, { value: 'saved', label: 'Saved' }] as item (item.value)}
				<Tabs.Trigger value={item.value} class="any-pointer-coarse:h-10"
					>{item.label}{#if item.value === 'agents' && agents?.pending}<Badge
							class="bg-waiting-soft text-waiting tabular-nums"
							><span aria-hidden="true">{agents.pending}</span><span class="sr-only"
								>, {agents.pending} need you</span
							></Badge
						>{/if}</Tabs.Trigger
				>
			{/each}
		</Tabs.List>
		{#if onclose}<Button
				size="icon-sm"
				variant="ghost"
				class="ms-auto -me-1.5 text-muted-foreground"
				aria-label="Close side panel"
				onclick={onclose}><X /></Button
			>{/if}
	</div>
	<Tabs.Content value="tasks" class="flex min-h-0 flex-col text-base">
		{#if task}{@render inspector(task)}{:else}{@render taskList()}{/if}
	</Tabs.Content>
	<Tabs.Content value="agents" class="flex min-h-0 flex-col text-base">
		<AgentsPanel
			conversationId={conversationId ?? 'main'}
			bind:selected={agentId}
			{docked}
			onnavigate={(href) => onnavigate?.(href)}
		/>
	</Tabs.Content>
	<Tabs.Content value="saved" class="flex min-h-0 flex-col text-base">
		<SavedPanel conversationId={conversationId ?? 'main'} />
	</Tabs.Content>
</Tabs.Root>
