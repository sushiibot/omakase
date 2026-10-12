<script lang="ts">
	import { untrack } from 'svelte';
	import { request } from '$lib/core/http';
	import { Button } from '$lib/ui/button';
	import { tasksStore } from './tasks.svelte';
	import type { TaskRecord } from './types';
	let { task, beforeStart }: { task: TaskRecord; beforeStart?: () => Promise<boolean> } = $props();
	type Machine = {
		id: string;
		name: string;
		connected: boolean;
		roots: { id: string; name: string; coding: boolean }[];
		providers: ('codex' | 'claude')[];
	};
	type Session = {
		status: string;
		output: string;
		error?: string;
		attempts: number;
		requests: { id: string | number; description: string }[];
	};
	let machines = $state<Machine[]>([]);
	let discovering = $state(true);
	let discoveryError = $state<string | null>(null);
	let selected = $state('');
	let session = $state<Session | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);
	let prompt = $state('');
	const store = tasksStore();
	const targets = $derived(
		machines
			.filter((m) => m.connected)
			.flatMap((m) =>
				m.roots
					.filter((r) => r.coding)
					.flatMap((r) =>
						m.providers.map((provider) => ({
							key: `${m.id}/${r.id}/${provider}`,
							machineId: m.id,
							rootId: r.id,
							provider,
							label: `${m.name} · ${r.name} · ${provider === 'codex' ? 'Codex' : 'Claude Code'}`
						}))
					)
			)
	);
	async function discover() {
		discovering = true;
		discoveryError = null;
		try {
			machines = (await request<{ machines: Machine[] }>('GET', '/machines')).machines;
		} catch (err) {
			discoveryError = err instanceof Error ? err.message : 'Could not load machines.';
		} finally {
			discovering = false;
		}
	}
	$effect(() => {
		void discover();
	});
	$effect(() => {
		const id = task.execution?.sessionId;
		if (!id) return;
		let live = true;
		let loading = false;
		const taskId = untrack(() => task.id);
		const load = async () => {
			if (loading || document.hidden) return;
			loading = true;
			try {
				const result = await request<{ session: Session }>('GET', `/machines/tasks/${taskId}`);
				if (live) {
					session = result.session;
					error = null;
				}
			} catch (err) {
				if (live) error = err instanceof Error ? err.message : 'Could not reach this machine.';
			} finally {
				loading = false;
			}
		};
		void load();
		const timer = setInterval(() => void load(), 3000);
		return () => {
			live = false;
			clearInterval(timer);
		};
	});
	async function start(followup = false) {
		if (busy || store.busy) return;
		if (beforeStart && !(await beforeStart())) return;
		const target = targets.find((t) => t.key === selected);
		if (!task.execution && !target) return;
		busy = true;
		error = null;
		const text = prompt;
		try {
			const result = await store.action({
				action: 'start',
				id: task.id,
				...(task.execution
					? {}
					: {
							target: {
								machineId: target!.machineId,
								rootId: target!.rootId,
								provider: target!.provider
							}
						}),
				...(followup ? { text } : {})
			});
			if (!result) error = store.error ?? 'Could not start this session.';
			else {
				prompt = '';
				session = null;
			}
		} finally {
			busy = false;
		}
	}
	async function stop() {
		busy = true;
		try {
			await store.action({ action: 'stop', id: task.id });
		} finally {
			busy = false;
		}
	}
	async function answer(requestId: string | number, decision: 'accept' | 'decline') {
		busy = true;
		try {
			const result = await request<{ session: Session }>(
				'POST',
				`/machines/tasks/${task.id}/answer`,
				{ requestId, decision }
			);
			session = result.session;
			error = null;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not answer this approval.';
		} finally {
			busy = false;
		}
	}
</script>

<section class="flex flex-col gap-3" class:min-h-full={!!task.execution} aria-label="Remote work">
	<h3 class="text-sm font-semibold">
		{task.execution ? 'Remote session' : 'Work on another machine'}
	</h3>
	{#if task.execution}
		<p class="text-sm [overflow-wrap:anywhere] text-muted-foreground">
			{task.execution.provider === 'codex' ? 'Codex' : 'Claude Code'} · {task.execution.machineId} · {task
				.execution.rootId}
		</p>
		{#if session}
			<p class="text-sm">{session.status.replaceAll('-', ' ')} · Attempt {session.attempts}</p>
			{#if session.output}<pre
					class="max-h-80 overflow-y-auto rounded-lg border bg-muted/30 p-3 font-mono text-sm [overflow-wrap:anywhere] whitespace-pre-wrap"
					aria-label="Remote session output">{session.output}</pre>{/if}
			{#if session.error}<p class="text-sm text-failed">{session.error}</p>{/if}
		{/if}
		{#if !session?.requests.length}
			<form
				class="flex flex-col gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					void start(true);
				}}
			>
				<label class="flex flex-col gap-1 text-sm"
					>Follow up<textarea
						class="min-h-24 rounded-lg border bg-background p-3 text-base"
						rows="3"
						maxlength="16000"
						bind:value={prompt}
						placeholder="Give this session more direction…"></textarea></label
				>
				<Button
					type="submit"
					disabled={busy ||
						store.busy ||
						!prompt.trim() ||
						session?.status === 'running' ||
						session?.status === 'needs-you'}
					>Send to {task.execution.provider === 'codex' ? 'Codex' : 'Claude Code'}</Button
				>
			</form>
		{:else}
			<div class="mt-auto flex flex-col gap-3">
				{#each session.requests as approval (approval.id)}
					<div class="flex flex-col gap-2 border-t pt-3">
						<p class="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
							{approval.description}
						</p>
						<div class="flex gap-2">
							<Button disabled={busy} onclick={() => void answer(approval.id, 'accept')}
								>Approve</Button
							><Button
								variant="outline"
								disabled={busy}
								onclick={() => void answer(approval.id, 'decline')}>Deny</Button
							>
						</div>
					</div>
				{/each}
			</div>
		{/if}
		{#if session?.status === 'running' || session?.status === 'needs-you'}<Button
				variant="outline"
				disabled={busy || store.busy}
				onclick={() => void stop()}>Stop remote work</Button
			>{/if}
	{:else if discovering}
		<p role="status" class="text-sm text-muted-foreground">Loading machines…</p>
	{:else if discoveryError}
		<p role="alert" class="text-sm text-failed">{discoveryError}</p>
		<Button variant="outline" onclick={() => void discover()}>Retry machine connection</Button>
	{:else if !machines.length}
		<p class="text-sm text-muted-foreground">
			No machines are configured. Connect your PC or file server to use remote work.
		</p>
		<Button
			variant="outline"
			href="https://github.com/sushiibot/omakase/blob/main/docs/machines.md"
			target="_blank"
			rel="noopener noreferrer">Set up a machine</Button
		>
	{:else}
		<label class="flex flex-col gap-1 text-sm"
			>Machine and folder<select
				class="min-h-12 min-w-0 rounded-lg border bg-background px-3 text-base"
				bind:value={selected}
				disabled={busy || !targets.length}
				><option value="">Choose where to work…</option
				>{#each targets as target (target.key)}<option value={target.key}>{target.label}</option
					>{/each}</select
			></label
		>
		{#if !targets.length}<p class="text-sm text-muted-foreground">
				No machine has an available coding folder. Connect its daemon to start remote work.
			</p>{/if}
		<Button
			variant="outline"
			disabled={busy || store.busy || !selected || task.status === 'in-progress'}
			onclick={() => void start()}>Start on selected machine</Button
		>
	{/if}
	{#if error}<p role="alert" class="text-sm [overflow-wrap:anywhere] text-failed">{error}</p>{/if}
</section>
