<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import Play from '@lucide/svelte/icons/play';
	import Square from '@lucide/svelte/icons/square';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/ui/button';
	import ChecklistCheckbox from '$lib/ui/checklist-checkbox.svelte';
	import * as Field from '$lib/ui/field';
	import { Input } from '$lib/ui/input';
	import * as InputGroup from '$lib/ui/input-group';
	import { PageHeader } from '$lib/ui/page';
	import { Textarea } from '$lib/ui/textarea';
	import type { TaskRecord } from './types';
	import { taskLabels } from './types';
	let {
		task,
		busy,
		error,
		fullHref,
		runs,
		onclose,
		onback,
		onupdate,
		onstart,
		onstop,
		onretry
	}: {
		task: TaskRecord;
		busy: boolean;
		error: string | null;
		fullHref: string;
		runs?: Snippet;
		onclose?: () => void;
		onback: () => void;
		onupdate: (
			patch: Partial<Pick<TaskRecord, 'title' | 'brief' | 'status' | 'checklist'>>
		) => Promise<boolean>;
		onstart: (text?: string) => Promise<boolean>;
		onstop: () => void;
		onretry: () => void;
	} = $props();
	const uid = $props.id();
	let tab = $state<'details' | 'activity' | 'results'>('details');
	let editing = $state(false);
	let title = $state(untrack(() => task.title));
	let brief = $state(untrack(() => task.brief));
	let step = $state('');
	let savedTitle = $state(untrack(() => task.title));
	let savedBrief = $state(untrack(() => task.brief));
	$effect(() => {
		if (task.title !== savedTitle) {
			if (title === savedTitle) title = task.title;
			savedTitle = task.title;
		}
		if (task.brief !== savedBrief) {
			if (brief === savedBrief) brief = task.brief;
			savedBrief = task.brief;
		}
	});
	async function save() {
		if (await onupdate({ title: title.trim(), brief })) {
			savedTitle = title.trim();
			savedBrief = brief;
			editing = false;
			return true;
		}
		return false;
	}
	async function addStep() {
		if (
			!busy &&
			step.trim() &&
			task.checklist.length < 100 &&
			(await onupdate({
				checklist: [
					...task.checklist,
					{ id: `c-${crypto.randomUUID()}`, title: step.trim(), done: false }
				]
			}))
		)
			step = '';
	}
	async function start() {
		if (!title.trim()) return;
		if ((title !== task.title || brief !== task.brief) && !(await save())) return;
		if (await onstart()) tab = 'activity';
	}
</script>

<div class="flex min-h-0 flex-1 flex-col" data-task-inspector>
	{#snippet leading()}<Button
			size="icon-sm"
			variant="ghost"
			class="-ms-1.5 text-muted-foreground"
			aria-label="Back to tasks"
			onclick={onback}><ChevronLeft /></Button
		>{/snippet}
	{#snippet subtitle()}{taskLabels[task.status]}{task.agent ? ` · ${task.agent}` : ''}{/snippet}
	{#snippet actions()}<Button
			size="icon-sm"
			variant="ghost"
			class="text-muted-foreground"
			aria-label="Close task details"
			onclick={onclose}><X /></Button
		>{/snippet}
	<PageHeader
		title="Task details"
		level={2}
		{leading}
		{subtitle}
		actions={onclose ? actions : undefined}
	/>
	<div class="flex shrink-0 border-b px-2" aria-label="Task sections">
		{#each ['details', 'activity', 'results'] as value}<Button
				variant="ghost"
				class="min-w-0 flex-1 rounded-none border-x-0 border-t-0 border-b-2 px-2 any-pointer-coarse:h-10 any-pointer-coarse:after:hidden {tab ===
				value
					? 'border-primary text-foreground'
					: 'border-transparent text-muted-foreground'}"
				aria-pressed={tab === value}
				onclick={() => (tab = value as typeof tab)}
				>{value === 'details' ? 'Details' : value === 'activity' ? 'Activity' : 'Results'}</Button
			>
		{/each}
	</div>
	{#if error}<div role="alert" class="shrink-0 px-4 py-2 text-sm text-failed">
			{error}<Button variant="ghost" onclick={onretry}>Reload</Button>
		</div>{/if}
	<div
		class:hidden={tab !== 'details'}
		class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
	>
		<div class="flex flex-col gap-6">
			<div class="flex flex-col gap-2">
				<h3 class="text-body font-semibold [overflow-wrap:anywhere]">{task.title}</h3>
				<Button variant="outline" href={fullHref}>Jump to conversation</Button>
			</div>
			{#if !editing}
				<section class="flex flex-col gap-2" aria-label="Task brief">
					<h3 class="text-sm font-semibold">Brief</h3>
					<p class="text-ui [overflow-wrap:anywhere] whitespace-pre-wrap">
						{task.brief || 'Add a brief to describe what needs to happen.'}
					</p>
					<Button variant="ghost" class="self-start px-3" onclick={() => (editing = true)}
						>Edit details</Button
					>
				</section>
			{:else}
				<form
					class="flex flex-col gap-3"
					onsubmit={(e) => {
						e.preventDefault();
						void save();
					}}
				>
					<Field.Field>
						<Field.Label for="{uid}-title">Task</Field.Label>
						<Input id="{uid}-title" maxlength={200} required bind:value={title} />
					</Field.Field>
					<Field.Field>
						<Field.Label for="{uid}-brief">Brief</Field.Label>
						<Textarea
							id="{uid}-brief"
							maxlength={16000}
							rows={4}
							placeholder="What needs to happen? What does done look like?"
							bind:value={brief}
						/>
					</Field.Field>
					{#if title !== task.title || brief !== task.brief}<Button
							type="submit"
							variant="outline"
							disabled={busy || !title.trim()}>Save changes</Button
						>{/if}
				</form>
				<Button
					variant="ghost"
					onclick={() => {
						title = task.title;
						brief = task.brief;
						editing = false;
					}}>Cancel editing</Button
				>
			{/if}
			<section class="flex flex-col gap-2" aria-label="Checklist">
				<h3 class="text-sm font-semibold">
					Checklist {#if task.checklist.length}<span class="text-muted-foreground"
							>{task.checklist.filter((c) => c.done).length}/{task.checklist.length}</span
						>{/if}
				</h3>
				{#each task.checklist as item (item.id)}<div
						class="flex min-h-12 items-center gap-1 border-b"
					>
						<ChecklistCheckbox
							checked={item.done}
							disabled={busy}
							label={item.title}
							onchange={() =>
								void onupdate({
									checklist: task.checklist.map((c) =>
										c.id === item.id ? { ...c, done: !c.done } : c
									)
								})}
						/><span class="text-ui [overflow-wrap:anywhere]" class:line-through={item.done}
							>{item.title}</span
						>
					</div>{/each}
				<form
					onsubmit={(e) => {
						e.preventDefault();
						void addStep();
					}}
				>
					<InputGroup.Root>
						<InputGroup.Input
							aria-label="New checklist step"
							maxlength={300}
							placeholder="Add a step…"
							bind:value={step}
						/>
						<InputGroup.Addon align="inline-end">
							<InputGroup.Button
								size="icon-sm"
								type="submit"
								aria-label="Add checklist step"
								aria-disabled={busy || !step.trim() || task.checklist.length >= 100}
								><Plus /></InputGroup.Button
							>
						</InputGroup.Addon>
					</InputGroup.Root>
				</form>
			</section>
			<div class="flex flex-col gap-2 any-pointer-coarse:gap-4">
				<Button disabled={busy} onclick={() => void start()}
					><Play />{task.workConversationId
						? 'Continue with Sushii'
						: 'Ask Sushii to work on this'}</Button
				>
				{#if task.status === 'in-progress'}<Button
						variant="outline"
						disabled={busy}
						onclick={onstop}><Square />Stop active work</Button
					>{/if}
				<Button
					variant="ghost"
					disabled={busy}
					onclick={() => void onupdate({ status: task.status === 'done' ? 'todo' : 'done' })}
					>{task.status === 'done' ? 'Reopen task' : 'Mark done'}</Button
				>
				{#if task.status !== 'cancelled' && task.status !== 'in-progress'}<Button
						variant="ghost"
						disabled={busy}
						onclick={() => void onupdate({ status: 'cancelled' })}>Cancel task</Button
					>{/if}
			</div>
		</div>
	</div>
	<div
		class:hidden={tab !== 'activity'}
		class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
	>
		<h3 class="mb-2 text-sm font-semibold">Execution activity</h3>
		<p class="mb-4 text-sm text-muted-foreground">
			Open an attempt to review its steps, checks and outputs. Finishing an attempt does not
			automatically complete the task.
		</p>
		{#if task.runIds.length}{@render runs?.()}{:else}<p class="text-sm text-muted-foreground">
				No execution activity yet. Ask Sushii to work on this task from Details.
			</p>{/if}
	</div>
	<div
		class:hidden={tab !== 'results'}
		class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
	>
		<h3 class="mb-2 text-sm font-semibold">Latest result</h3>
		{#if task.result}<p class="text-ui [overflow-wrap:anywhere] whitespace-pre-wrap">
				{task.result}
			</p>{:else}<p class="text-sm text-muted-foreground">
				No result yet. Completed work will appear here.
			</p>{/if}
		<Button variant="outline" class="mt-4 w-full" href={fullHref}>Jump to conversation</Button>
	</div>
</div>
