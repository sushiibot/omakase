<script lang="ts">
	import { tasksStore } from './tasks.svelte';
	import TaskList from './task-list.svelte';
	import TaskDetail from './task-detail.svelte';
	import TaskInspector from './task-inspector.svelte';
	import TaskChat from './task-chat.svelte';
	import TaskRuns from './task-runs.svelte';
	import { Button } from '$lib/ui/button';
	import Screen from '$lib/ui/screen/screen.svelte';
	import X from '@lucide/svelte/icons/x';
	import * as Tabs from '$lib/ui/tabs';
	import { Badge } from '$lib/ui/badge';
	import { AgentsPanel, agentList } from '$lib/features/agents';
	import type { TaskRecord } from './types';
	let {
		conversationId,
		selectedId = $bindable<string | undefined>(),
		onclose,
		fullPage = false,
		onselect,
		tab = $bindable<'tasks' | 'agents'>('tasks'),
		agentId = $bindable<string | undefined>(),
		docked = true,
		onnavigate
	}: {
		conversationId?: string;
		selectedId?: string;
		onclose?: () => void;
		fullPage?: boolean;
		onselect?: (id: string) => void;
		/** The side panel's tab: this conversation's tasks or its coding agents. */
		tab?: 'tasks' | 'agents';
		/** The agent open in the docked panel. */
		agentId?: string;
		docked?: boolean;
		/** Leaves the panel for a page, such as an agent's on phones. */
		onnavigate?: (href: string) => void;
	} = $props();
	const agents = $derived(
		fullPage || conversationId === '' ? null : agentList(conversationId ?? 'main')
	);
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
				// Route-owned selection mounts its editor once, at the destination.
				if (onselect) onselect(id);
				else selectedId = id;
			}}
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

{#if fullPage}
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
	{:else}<Screen title="Tasks" scrollable={false}
			><div class="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
				{@render taskList()}
			</div></Screen
		>{/if}
{:else}
	<Tabs.Root bind:value={tab} class="flex min-h-0 flex-1 flex-col">
		<header class="flex h-(--header-height) shrink-0 items-center gap-2 border-b px-2">
			<Tabs.List aria-label="Side panel" class="flex min-w-0 flex-1 gap-1 self-stretch">
				{#each [{ value: 'tasks', label: 'Tasks' }, { value: 'agents', label: 'Agents' }] as item (item.value)}
					<Tabs.Trigger
						value={item.value}
						class="relative flex min-h-12 min-w-12 items-center gap-1.5 px-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=active]:text-foreground data-[state=active]:after:absolute data-[state=active]:after:inset-x-2 data-[state=active]:after:bottom-0 data-[state=active]:after:h-0.5 data-[state=active]:after:bg-foreground"
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
					size="icon"
					variant="ghost"
					class="shrink-0"
					aria-label="Close side panel"
					onclick={onclose}><X /></Button
				>{/if}
		</header>
		<Tabs.Content value="tasks" class="flex min-h-0 flex-1 flex-col">
			{#if task}{@render inspector(task)}{:else}{@render taskList()}{/if}
		</Tabs.Content>
		<Tabs.Content value="agents" class="flex min-h-0 flex-1 flex-col">
			<AgentsPanel
				conversationId={conversationId ?? 'main'}
				bind:selected={agentId}
				{docked}
				onnavigate={(href) => onnavigate?.(href)}
			/>
		</Tabs.Content>
	</Tabs.Root>
{/if}
