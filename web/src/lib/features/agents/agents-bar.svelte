<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { Button } from '$lib/ui/button';
	import { SwitchRow } from '$lib/ui/switch';
	import StatePill from '$lib/ui/status/state-pill.svelte';
	import type { StatusKey } from '$lib/ui/status/status';
	import {
		agentName,
		agentsApi,
		choices,
		requestKey,
		requestView,
		visibleAgents,
		type AgentRecord,
		type AgentSession,
		type AgentStatus,
		type AgentsApi,
		type Decision
	} from './api';

	let {
		conversationId,
		focusAgent,
		api = agentsApi
	}: {
		conversationId: string;
		/** From a notification link: open this agent's row and move focus to its approval. */
		focusAgent?: string;
		api?: AgentsApi;
	} = $props();

	let agents = $state<AgentRecord[]>([]);
	let open = $state<string | null>(untrack(() => focusAgent ?? null));
	let session = $state<AgentSession | null>(null);
	let unavailable = $state<string | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);
	/** The request being answered, so its buttons say so until the machine replies. */
	let submitting = $state<string | null>(null);
	let wholeTurn = $state<Record<string, boolean>>({});
	let text = $state('');
	let region = $state<HTMLElement | null>(null);
	let focused = false;
	const shown = $derived(visibleAgents(agents));
	const current = $derived(shown.find((a) => a.id === open) ?? null);

	const pill: Record<AgentStatus, { of: StatusKey; label?: string }> = {
		running: { of: 'running' },
		'needs-you': { of: 'waiting', label: 'Needs approval' },
		completed: { of: 'done' },
		failed: { of: 'failed' },
		stopped: { of: 'aborted' },
		interrupted: { of: 'failed', label: 'Interrupted' }
	};

	$effect(() => {
		const id = conversationId;
		let live = true;
		const load = async () => {
			if (document.hidden) return;
			try {
				const result = await api.list(id);
				if (live) agents = result.agents;
			} catch {
				/* The bar stays as it was; the next poll retries. */
			}
		};
		void load();
		const timer = setInterval(() => void load(), 5000);
		return () => {
			live = false;
			clearInterval(timer);
		};
	});

	$effect(() => {
		const id = open;
		if (!id) return;
		let live = true;
		const load = async () => {
			if (document.hidden) return;
			try {
				const result = await api.get(id);
				if (!live) return;
				session = result.session ?? null;
				unavailable = result.unavailable ?? null;
			} catch (err) {
				if (live) unavailable = err instanceof Error ? err.message : 'Could not reach this agent.';
			}
		};
		void load();
		const timer = setInterval(() => void load(), 3000);
		return () => {
			live = false;
			clearInterval(timer);
		};
	});

	// A notification link lands on the approval itself, once.
	$effect(() => {
		if (focused || !focusAgent || open !== focusAgent || !session?.requests.length || !region)
			return;
		focused = true;
		void tick().then(() => {
			region?.scrollIntoView({ block: 'nearest' });
			// The approval itself takes focus, not Approve: a stray Enter must not answer it.
			region?.querySelector<HTMLElement>('[data-approval] h3')?.focus();
		});
	});

	function toggle(id: string) {
		open = open === id ? null : id;
		session = null;
		unavailable = null;
		error = null;
	}

	async function act(run: () => Promise<{ session: AgentSession }>, failure: string) {
		busy = true;
		error = null;
		try {
			session = (await run()).session;
			return true;
		} catch (err) {
			error = err instanceof Error ? err.message : failure;
			return false;
		} finally {
			busy = false;
		}
	}

	async function answer(agent: string, id: string | number, decision: Decision) {
		const key = requestKey(id);
		submitting = key;
		const sent = decision === 'accept' && wholeTurn[key] ? 'acceptForSession' : decision;
		try {
			await act(() => api.answer(agent, id, sent), 'Could not answer this approval.');
		} finally {
			submitting = null;
		}
	}
</script>

{#if shown.length}
	<section class="flex flex-col gap-1 border-t px-4 py-2" aria-label="Agents">
		{#each shown as agent (agent.id)}
			{@const state = pill[agent.remoteStatus ?? 'running']}
			<button
				type="button"
				class="flex min-h-12 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-muted/50"
				aria-expanded={open === agent.id}
				onclick={() => toggle(agent.id)}
			>
				<span class="flex min-w-0 flex-1 flex-col py-1"
					><span class="truncate font-medium">{agentName(agent)}</span><span
						class="truncate text-muted-foreground">{agent.title}</span
					>{#if agent.folder}<span
							class="truncate font-mono text-muted-foreground"
							title={agent.folder}>{agent.folder}</span
						>{/if}</span
				>
				<StatePill of={state.of} label={state.label} />
			</button>
		{/each}
		{#if current}
			<div
				bind:this={region}
				class="flex max-h-[50vh] flex-col gap-3 overflow-y-auto overscroll-contain px-2 pb-2"
				aria-label="{agentName(current)} details"
				role="region"
			>
				{#if unavailable && !session}<p class="text-sm text-muted-foreground">{unavailable}</p>{/if}
				{#if session}
					{#if session.status === 'running' || session.status === 'needs-you'}<Button
							variant="outline"
							disabled={busy}
							onclick={() => void act(() => api.stop(current.id), 'Could not stop this agent.')}
							>Stop agent</Button
						>{/if}
					{#if current.folder}<p class="text-sm [overflow-wrap:anywhere]">
							Folder: <span class="font-mono">{current.folder}</span>
						</p>{/if}
					<p class="text-sm text-muted-foreground">
						Attempt {session.attempts}{session.stalled ? ' · No output for a while' : ''}
					</p>
					{#if session.output}<pre
							class="max-h-60 overflow-y-auto rounded-lg border bg-muted/30 p-3 font-mono text-sm [overflow-wrap:anywhere] whitespace-pre-wrap"
							aria-label="Agent output">{session.output}</pre>{/if}
					{#if session.error}<p class="text-sm [overflow-wrap:anywhere] text-failed">
							{session.error}
						</p>{/if}
					{#if session.deniedTools?.length}<p class="text-sm text-muted-foreground">
							Denied without asking: {session.deniedTools.join(', ')}. Allow them in the CLI's
							settings on the machine.
						</p>{/if}
					{#each session.requests as approval (requestKey(approval.id))}
						{@const view = requestView(approval)}
						{@const key = requestKey(approval.id)}
						<div class="flex flex-col gap-2 border-t pt-3" data-approval>
							<h3 class="text-sm font-semibold" tabindex="-1">{view.title}</h3>
							{#if view.exact}
								<p class="text-sm text-muted-foreground">Exact input</p>
								<pre
									class="max-h-60 overflow-y-auto rounded-lg border bg-muted/30 p-3 font-mono text-sm [overflow-wrap:anywhere] whitespace-pre-wrap"
									aria-label="Exact input">{view.exact}</pre>
								{#if approval.detail?.cwd}<p class="text-sm [overflow-wrap:anywhere]">
										Working folder: <span class="font-mono">{approval.detail.cwd}</span>
									</p>{/if}
								{#if approval.detail?.reason}<p
										class="text-sm [overflow-wrap:anywhere] text-muted-foreground"
									>
										Agent's explanation: {approval.detail.reason}
									</p>{/if}
							{:else}
								<p class="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
									{approval.description}
								</p>
							{/if}
							{#if approval.decisions.includes('acceptForSession')}<SwitchRow
									checked={wholeTurn[key] ?? false}
									disabled={busy}
									onchange={(next) => (wholeTurn = { ...wholeTurn, [key]: next })}
									class="min-h-12 rounded-lg px-0 py-1.5"
									><span class="text-sm">Also allow matching requests until this turn ends</span
									></SwitchRow
								>{/if}
							<div class="flex flex-wrap gap-2">
								{#each choices(approval.decisions) as choice (choice.decision)}<Button
										variant={choice.primary ? 'default' : 'outline'}
										data-decision={choice.decision}
										disabled={busy}
										onclick={() => void answer(current.id, approval.id, choice.decision)}
										>{submitting === key && choice.primary ? 'Submitting…' : choice.label}</Button
									>{/each}
							</div>
						</div>
					{/each}
					{#if !session.requests.length}
						<form
							class="flex flex-col gap-2"
							onsubmit={async (e) => {
								e.preventDefault();
								const sent = text;
								if (await act(() => api.message(current.id, sent), 'Could not send this message.'))
									text = '';
							}}
						>
							<label class="flex flex-col gap-1 text-sm"
								>Message this agent<textarea
									class="min-h-20 rounded-lg border bg-background p-3 text-base"
									rows="2"
									maxlength="16000"
									bind:value={text}></textarea></label
							>
							{#if session.status === 'running'}<p class="text-sm text-muted-foreground">
									{current.provider === 'codex'
										? 'Codex takes this message during its current turn.'
										: 'Claude Code stops its current turn, then continues with this message.'}
								</p>{/if}
							<Button type="submit" disabled={busy || !text.trim()}>Send to agent</Button>
						</form>
					{/if}
				{/if}
				{#if error}<p role="alert" class="text-sm [overflow-wrap:anywhere] text-failed">
						{error}
					</p>{/if}
			</div>
		{/if}
	</section>
{/if}
