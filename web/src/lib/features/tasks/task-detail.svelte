<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import Play from '@lucide/svelte/icons/play';
	import Square from '@lucide/svelte/icons/square';
	import { Button } from '$lib/ui/button';
	import { Checkbox } from '$lib/ui/checkbox';
	import { Label } from '$lib/ui/label';
	import * as Field from '$lib/ui/field';
	import { Input } from '$lib/ui/input';
	import * as InputGroup from '$lib/ui/input-group';
	import { measureClass, Body as PageBody } from '$lib/ui/page';
	import Section from '$lib/ui/section/section.svelte';
	import { Textarea } from '$lib/ui/textarea';
	import type { TaskRecord } from './types';
	let {
		task,
		busy,
		error,
		conversation,
		runs,
		onupdate,
		onstart,
		onstop,
		onretry
	}: {
		task: TaskRecord;
		busy: boolean;
		error: string | null;
		conversation?: Snippet<[viewing: boolean]>;
		runs?: Snippet;
		onupdate: (
			patch: Partial<Pick<TaskRecord, 'title' | 'brief' | 'status' | 'checklist'>>
		) => Promise<boolean>;
		onstart: (text?: string) => Promise<boolean>;
		onstop: () => void;
		onretry: () => void;
	} = $props();
	const uid = $props.id();
	let tab = $state<'overview' | 'conversation' | 'runs'>('overview');
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
		if (await onstart()) tab = 'conversation';
	}
</script>

{#snippet progress()}<span class="tabular-nums"
		>{task.checklist.filter((c) => c.done).length}/{task.checklist.length} done</span
	>{/snippet}

<div class="flex h-full min-h-0 flex-col" data-task-detail>
	<div class="shrink-0 border-b px-2 md:px-4" role="group" aria-label="Task sections">
		<div class="{measureClass.reading} flex">
			{#each ['overview', 'conversation', 'runs'] as value}<Button
					variant="ghost"
					class="min-w-0 flex-1 rounded-none border-x-0 border-t-0 border-b-2 px-2 any-pointer-coarse:h-10 any-pointer-coarse:after:hidden {tab ===
					value
						? 'border-primary text-foreground'
						: 'border-transparent text-muted-foreground'}"
					aria-pressed={tab === value}
					onclick={() => (tab = value as typeof tab)}
					>{value === 'overview'
						? 'Overview'
						: value === 'conversation'
							? 'Conversation'
							: 'Runs'}</Button
				>{/each}
		</div>
	</div>
	{#if error}<div role="alert" class="shrink-0 px-4 py-2 text-sm text-failed">
			{error}<Button variant="ghost" onclick={onretry}>Reload</Button>
		</div>{/if}
	<div class:hidden={tab !== 'overview'} class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<PageBody>
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
			<Section title="Checklist" aside={task.checklist.length ? progress : undefined}>
				{#each task.checklist as item (item.id)}<Label
						class="min-h-10 gap-3 border-b px-1 py-2 leading-snug font-normal any-pointer-coarse:min-h-11"
					>
						<Checkbox
							checked={item.done}
							disabled={busy}
							onCheckedChange={() =>
								void onupdate({
									checklist: task.checklist.map((c) =>
										c.id === item.id ? { ...c, done: !c.done } : c
									)
								})}
						/><span class="[overflow-wrap:anywhere]" class:line-through={item.done}
							>{item.title}</span
						>
					</Label>{/each}
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
								class="any-pointer-coarse:w-10 any-pointer-coarse:after:inset-x-0"
								aria-disabled={busy || !step.trim() || task.checklist.length >= 100}
								><Plus /></InputGroup.Button
							>
						</InputGroup.Addon>
					</InputGroup.Root>
				</form>
			</Section>
			{#if task.result}<Section title="Latest result">
					<p class="text-ui [overflow-wrap:anywhere] whitespace-pre-wrap">{task.result}</p>
				</Section>{/if}
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
		</PageBody>
	</div>
	<div class:hidden={tab !== 'conversation'} class="flex min-h-0 flex-1 flex-col">
		{#if task.workConversationId}{@render conversation?.(tab === 'conversation')}{:else}<div
				class="flex flex-col gap-3 px-4 py-8"
			>
				<p class="text-sm text-muted-foreground">
					Start work to open this task's own conversation. Follow-ups stay with this task.
				</p>
				<Button disabled={busy} onclick={() => void start()}><Play />Start with Sushii</Button>
			</div>{/if}
	</div>
	<div class:hidden={tab !== 'runs'} class="min-h-0 flex-1 overflow-y-auto">
		<PageBody>
			<p class="text-sm text-muted-foreground">
				Each run records an execution attempt. Finishing a run does not automatically complete the
				task.
			</p>
			{#if !task.runIds.length}<p class="text-sm">No runs yet.</p>{/if}
			{@render runs?.()}
		</PageBody>
	</div>
</div>
