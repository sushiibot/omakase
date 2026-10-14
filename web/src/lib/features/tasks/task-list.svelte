<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import { Button } from '$lib/ui/button';
	import { Checkbox } from '$lib/ui/checkbox';
	import * as Empty from '$lib/ui/empty';
	import * as InputGroup from '$lib/ui/input-group';
	import * as Item from '$lib/ui/item';
	import Section from '$lib/ui/section/section.svelte';
	import { cn } from '$lib/utils';
	import type { TaskRecord } from './types';
	import { taskLabels, taskSections } from './types';
	let {
		tasks,
		loading = false,
		busy = false,
		error = null,
		class: className,
		oncreate,
		ontoggle,
		onselect,
		onretry
	}: {
		tasks: TaskRecord[];
		loading?: boolean;
		busy?: boolean;
		error?: string | null;
		class?: string;
		oncreate: (title: string) => Promise<boolean>;
		ontoggle: (task: TaskRecord) => void;
		onselect: (id: string) => void;
		onretry: () => void;
	} = $props();
	let title = $state('');
	let showDone = $state(false);
	const disclosureId = $props.id();
	async function add() {
		if (!busy && title.trim() && (await oncreate(title.trim()))) title = '';
	}
</script>

{#snippet rows(section: TaskRecord[], id?: string, hidden = false)}
	<Item.Group {id} {hidden} class="gap-0">
		{#each section as task (task.id)}
			<!-- gap-4 matches the checkbox's 16px coarse side reach, so it ends where the row button starts. -->
			<div role="listitem" class="flex min-w-0 items-center gap-3 ps-2 any-pointer-coarse:gap-4">
				<Checkbox
					checked={task.status === 'done'}
					disabled={busy}
					aria-label={`Mark ${task.title} ${task.status === 'done' ? 'to do' : 'done'}`}
					onCheckedChange={() => ontoggle(task)}
				/>
				<Button
					variant="ghost"
					class="h-auto min-h-10 min-w-0 flex-1 justify-start gap-2.5 px-2 py-2 text-left font-normal whitespace-normal any-pointer-coarse:min-h-11 any-pointer-coarse:after:hidden"
					onclick={() => onselect(task.id)}
				>
					<span class="flex min-w-0 flex-1 flex-col gap-1">
						<span
							class={cn('text-sm leading-snug font-medium [overflow-wrap:anywhere]', {
								'line-through': task.status === 'done'
							})}>{task.title}</span
						>
						{#if task.agent || task.checklist.length}<span class="text-xs text-muted-foreground"
								>{task.agent ?? 'Your task'}{task.checklist.length
									? ` · ${task.checklist.filter((c) => c.done).length}/${task.checklist.length} steps`
									: ''}</span
							>{/if}
					</span>
					<ChevronRight class="text-muted-foreground" aria-hidden="true" />
				</Button>
			</div>
		{/each}
	</Item.Group>
{/snippet}

<div class={cn('flex flex-col gap-4 md:gap-6', className)} data-task-list>
	<form
		onsubmit={(e) => {
			e.preventDefault();
			void add();
		}}
	>
		<InputGroup.Root>
			<InputGroup.Input
				aria-label="New task"
				maxlength={200}
				placeholder="Add a task…"
				bind:value={title}
			/>
			<InputGroup.Addon align="inline-end">
				<InputGroup.Button
					size="icon-sm"
					type="submit"
					aria-disabled={busy || !title.trim()}
					aria-label="Add task"
					class="any-pointer-coarse:w-10 any-pointer-coarse:after:inset-x-0"
					><Plus /></InputGroup.Button
				>
			</InputGroup.Addon>
		</InputGroup.Root>
	</form>
	{#if error}<div role="alert" class="flex flex-col items-start gap-2 text-sm text-failed">
			<p>{error}</p>
			<Button variant="outline" onclick={onretry}>Reload tasks</Button>
		</div>{/if}
	{#if loading}<p role="status" class="text-sm text-muted-foreground">Loading tasks…</p>
	{:else if !tasks.length && !error}<Empty.Root>
			<Empty.Header>
				<Empty.Media variant="icon"><CircleCheck /></Empty.Media>
				<Empty.Title>Room for your next task</Empty.Title>
				<Empty.Description>
					Save a to-do here, or ask Sushii to work on it. Starting work is a separate action.
				</Empty.Description>
			</Empty.Header>
		</Empty.Root>{/if}
	{#each taskSections as status (status)}
		{@const section = tasks
			.filter((t) => t.status === status)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))}
		{#if section.length}
			{#if status === 'done'}
				<section aria-label={taskLabels[status]} class="flex min-w-0 flex-col gap-2">
					<!-- The disclosure sits in the heading so heading navigation still reaches Done. -->
					<div role="heading" aria-level={2} class="flex">
						<Button
							variant="ghost"
							size="sm"
							class="self-start px-2 text-muted-foreground"
							aria-expanded={showDone}
							aria-controls={`${disclosureId}-done`}
							onclick={() => (showDone = !showDone)}
						>
							<ChevronRight
								class={cn('transition-transform motion-reduce:transition-none', {
									'rotate-90': showDone
								})}
								aria-hidden="true"
							/>
							Done <span class="font-normal tabular-nums">{section.length}</span>
						</Button>
					</div>
					{@render rows(section, `${disclosureId}-done`, !showDone)}
				</section>
			{:else}
				<Section title={taskLabels[status]} tone="list" count={section.length}>
					{@render rows(section)}
				</Section>
			{/if}
		{/if}
	{/each}
</div>
