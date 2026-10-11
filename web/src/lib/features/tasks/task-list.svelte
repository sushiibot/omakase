<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import { Button } from '$lib/ui/button';
	import ChecklistCheckbox from '$lib/ui/checklist-checkbox.svelte';
	import type { TaskRecord } from './types';
	import { taskLabels, taskSections } from './types';
	let {
		tasks,
		loading = false,
		busy = false,
		error = null,
		oncreate,
		ontoggle,
		onselect,
		onretry
	}: {
		tasks: TaskRecord[];
		loading?: boolean;
		busy?: boolean;
		error?: string | null;
		oncreate: (title: string) => Promise<boolean>;
		ontoggle: (task: TaskRecord) => void;
		onselect: (id: string) => void;
		onretry: () => void;
	} = $props();
	let title = $state('');
	async function add() {
		if (title.trim() && (await oncreate(title.trim()))) title = '';
	}
</script>

<div class="flex flex-col gap-5 px-4 py-4" data-task-list>
	<form
		onsubmit={(e) => {
			e.preventDefault();
			void add();
		}}
		class="flex gap-2"
	>
		<input
			aria-label="New task"
			maxlength="200"
			placeholder="Add a task…"
			bind:value={title}
			class="min-h-12 min-w-0 flex-1 rounded-lg border bg-background px-3 text-base"
		/>
		<Button
			type="submit"
			variant="outline"
			disabled={busy || !title.trim()}
			aria-label="Add task"
			class="size-12 shrink-0 px-0"><Plus /></Button
		>
	</form>
	{#if error}<div role="alert" class="flex flex-col gap-2 text-sm text-failed">
			<p>{error}</p>
			<Button variant="outline" onclick={onretry}>Reload tasks</Button>
		</div>{/if}
	{#if loading}<p role="status" class="text-sm text-muted-foreground">Loading tasks…</p>
	{:else if !tasks.length && !error}<div class="flex flex-col items-center gap-3 py-12 text-center">
			<CircleCheck class="size-8 text-muted-foreground" />
			<p class="font-medium">Room for your next task</p>
			<p class="max-w-64 text-sm text-muted-foreground">
				Save a to-do here, or ask Sushii to work on it. Starting work is a separate action.
			</p>
		</div>{/if}
	{#each taskSections as status (status)}
		{@const section = tasks
			.filter((t) => t.status === status)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))}
		{#if section.length}
			<section aria-label={taskLabels[status]} class="flex flex-col gap-1">
				<h2 class="mb-1 text-sm font-semibold">
					{taskLabels[status]} <span class="ml-1 text-muted-foreground">{section.length}</span>
				</h2>
				<ul class="divide-y">
					{#each section as task (task.id)}
						<li class="flex min-w-0 items-start gap-1">
							<ChecklistCheckbox
								checked={task.status === 'done'}
								disabled={busy}
								label={`Mark ${task.title} ${task.status === 'done' ? 'to do' : 'done'}`}
								onchange={() => ontoggle(task)}
							/>
							<button
								type="button"
								class="flex min-h-12 min-w-0 flex-1 items-center gap-2 py-3 text-left hover:bg-muted/50"
								onclick={() => onselect(task.id)}
							>
								<span class="flex min-w-0 flex-1 flex-col gap-1"
									><span
										class="text-ui font-medium [overflow-wrap:anywhere]"
										class:line-through={task.status === 'done'}>{task.title}</span
									>
									{#if task.agent || task.checklist.length}<span
											class="text-meta text-muted-foreground"
											>{task.agent ?? 'Your task'}{task.checklist.length
												? ` · ${task.checklist.filter((c) => c.done).length}/${task.checklist.length} steps`
												: ''}</span
										>{/if}</span
								>
								<ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/each}
</div>
