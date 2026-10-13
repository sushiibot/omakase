<script lang="ts">
	import { tick, untrack } from 'svelte';
	import Square from '@lucide/svelte/icons/square';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import Hand from '@lucide/svelte/icons/hand';
	import { Button } from '$lib/ui/button';
	import ActionMenu from '$lib/ui/menu/action-menu.svelte';
	import StatePill from '$lib/ui/status/state-pill.svelte';
	import { Composer, Markdown } from '$lib/features/chat';
	import { measureClass } from '$lib/ui/page';
	import { cn } from '$lib/utils';
	import AgentHeader from './agent-header.svelte';
	import ApprovalCard from './approval-card.svelte';
	import WorkGroup from './work-group.svelte';
	import { agentAge, agentMeta, agentState, placeRequests, requestKey, turns } from '../model';
	import type { AgentRecord, AgentSession, Decision } from '../types';
	let {
		agent,
		session,
		unavailable,
		actionError,
		busy = false,
		submitting = null,
		now,
		focusRequest = false,
		conversationHref,
		pageHref,
		backLabel = 'Back to agents',
		level = 1,
		onback,
		onstop,
		onanswer,
		onmessage
	}: {
		agent: AgentRecord;
		session?: AgentSession;
		/** Why the live session can't be read, such as the machine being offline. */
		unavailable?: string | null;
		actionError?: string | null;
		busy?: boolean;
		submitting?: string | null;
		now: number;
		/** Opened from a notification: bring the pending request into view and focus its heading. */
		focusRequest?: boolean;
		conversationHref: string;
		/** The full-page view, offered from the panel. */
		pageHref?: string;
		backLabel?: string;
		/** 2 inside the side panel, under its own tabs. */
		level?: 1 | 2;
		onback: () => void;
		onstop: () => Promise<boolean>;
		onanswer: (requestId: string | number, decision: Decision) => void;
		onmessage: (text: string) => Promise<boolean>;
	} = $props();

	const draftKey = untrack(() => `agent-draft:${agent.id}`);
	let draft = $state(
		untrack(() => {
			try {
				return sessionStorage.getItem(draftKey) ?? '';
			} catch {
				return '';
			}
		})
	);
	$effect(() => {
		const text = draft;
		try {
			if (text) sessionStorage.setItem(draftKey, text);
			else sessionStorage.removeItem(draftKey);
		} catch {
			/* The draft lives only in memory. */
		}
	});

	const record = $derived(
		session ? { ...agent, remoteStatus: session.status, stalled: session.stalled } : agent
	);
	const status = $derived(agentState(record));
	const items = $derived.by(() => {
		if (!session?.transcript) return null;
		const all = turns(session.transcript);
		// A session that is no longer live has ended its last turn, even when the machine missed recording it.
		const last = all[all.length - 1];
		if (last && !last.end && !live) {
			const at = [...last.work].pop()?.at ?? last.startedAt ?? new Date(now).toISOString();
			last.end = { kind: 'turnEnd', status: session.status, at };
		}
		return all;
	});
	const requests = $derived(session?.requests ?? []);
	const placement = $derived(placeRequests(items ?? [], session?.transcript ? requests : []));
	const live = $derived(session?.status === 'running' || session?.status === 'needs-you');

	let scroller = $state<HTMLElement | null>(null);
	let composerBox = $state<HTMLElement | null>(null);
	let away = $state(false);
	function firstRequest() {
		return scroller?.querySelector<HTMLElement>('[data-approval]') ?? null;
	}
	function review() {
		const card = firstRequest();
		card?.scrollIntoView({ block: 'nearest' });
		card?.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
	}
	// The pointer shows only while the pending card is out of view.
	$effect(() => {
		void requests.length;
		const root = scroller;
		const card = untrack(firstRequest);
		if (!root || !card) {
			away = false;
			return;
		}
		const observer = new IntersectionObserver(([entry]) => (away = !entry!.isIntersecting), {
			root,
			threshold: 0.2
		});
		observer.observe(card);
		return () => observer.disconnect();
	});

	// Opens at the newest step, like a chat; an explicit open lands on a pending request's heading.
	let opened = false;
	$effect(() => {
		if (opened || !scroller || !session) return;
		opened = true;
		void tick().then(() => {
			if (focusRequest && session?.requests.length) review();
			else if (scroller) scroller.scrollTop = scroller.scrollHeight;
		});
	});

	let announcement = $state('');
	let lastAnnounced = untrack(() => `${session?.status}:${session?.requests.length ?? 0}`);
	$effect(() => {
		if (!session) return;
		const key = `${session.status}:${session.requests.length}`;
		if (key === lastAnnounced) return;
		lastAnnounced = key;
		announcement =
			session.status === 'needs-you'
				? `${agent.title} needs approval`
				: session.status === 'completed'
					? `${agent.title} finished`
					: session.status === 'failed'
						? `${agent.title} failed`
						: session.status === 'stopped'
							? `${agent.title} stopped`
							: session.status === 'interrupted'
								? `${agent.title} was interrupted`
								: `${agent.title} is running`;
	});

	async function stop() {
		if (await onstop()) composerBox?.querySelector('textarea')?.focus();
	}
	async function send() {
		const text = draft.trim();
		if (!text) return;
		if (await onmessage(text)) draft = '';
	}
	async function copyFolder(close: () => void) {
		close();
		try {
			await navigator.clipboard.writeText(agent.folder ?? '');
		} catch {
			/* Clipboard refused; the folder is visible in the header. */
		}
	}
	const sender = (origin?: 'owner' | 'agent') =>
		origin === 'owner' ? 'From you' : origin === 'agent' ? 'From Sushii' : 'Message';
	const placeholder = $derived(
		session?.status === 'running'
			? agent.provider === 'codex'
				? 'Steer this agent: Codex reads it during this turn'
				: 'Redirect: Claude Code stops this turn, then continues with it'
			: 'Message this agent to continue'
	);
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col text-base" data-agent-detail={agent.id}>
	<AgentHeader title={agent.title} {level} {backLabel} {onback}>
		{#snippet subtitle()}
			<span class="flex items-center gap-2">
				<StatePill of={status.of} label={status.label} />
				<span class="tabular-nums">{agentAge(record, now)}</span>
			</span>
		{/snippet}
		{#snippet actions()}
			{#if live}<Button variant="outline" disabled={busy} onclick={() => void stop()}
					><Square class="fill-current text-failed" />Stop</Button
				>{/if}
			<ActionMenu label="Agent actions">
				{#snippet children(close)}
					<Button
						variant="ghost"
						class="w-full justify-start"
						href={conversationHref}
						onclick={close}>Jump to conversation</Button
					>
					{#if pageHref}<Button
							variant="ghost"
							class="w-full justify-start"
							href={pageHref}
							onclick={close}>Open full page</Button
						>{/if}
					{#if agent.folder}<Button
							variant="ghost"
							class="w-full justify-start"
							onclick={() => void copyFolder(close)}>Copy folder path</Button
						>{/if}
				{/snippet}
			</ActionMenu>
		{/snippet}
	</AgentHeader>
	<p class="sr-only" role="status">{announcement}</p>
	<div
		bind:this={scroller}
		class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
		data-agent-scroll
	>
		<div
			role="log"
			aria-live="off"
			aria-label="{agent.title} transcript"
			class={cn('flex w-full min-w-0 flex-col gap-4', measureClass.reading)}
		>
			<p class="text-xs break-all text-muted-foreground">{agentMeta(agent)}</p>
			{#if !session && unavailable}<p class="text-sm text-muted-foreground">{unavailable}</p>{/if}
			{#if !session && !unavailable}<p role="status" class="text-sm text-muted-foreground">
					Loading this agent…
				</p>{/if}
			{#if items}
				{#each items as turn, index (index)}
					{#if turn.prompt}
						<div class="flex min-w-0 flex-col items-end gap-1" data-prompt>
							<p class="text-meta text-muted-foreground">{sender(turn.prompt.origin)}</p>
							<p
								class="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-body leading-snug [overflow-wrap:anywhere] whitespace-pre-wrap"
							>
								{turn.prompt.text}
							</p>
						</div>
					{/if}
					{@const work = turn.work.filter((i) => !placement.items.has(i))}
					{#if work.length || !turn.end}
						<WorkGroup turn={{ ...turn, work }} number={index + 1} {now} />
					{/if}
					{#each placement.byTurn.get(index) ?? [] as request (requestKey(request.id))}
						<ApprovalCard
							{request}
							{agent}
							{busy}
							submitting={submitting === requestKey(request.id)}
							ondecide={(decision) => onanswer(request.id, decision)}
						/>
					{/each}
					{#if turn.answer}
						<div class="min-w-0 text-body" data-answer>
							<Markdown text={turn.answer.text} />
						</div>
					{/if}
					{#if turn.end && (turn.end.status === 'failed' || turn.end.status === 'interrupted')}
						<p class="flex items-start gap-2 text-ui [overflow-wrap:anywhere] text-failed">
							<CircleX class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
							{turn.end.status === 'failed' ? 'Failed' : 'Interrupted'}{turn.end.error
								? `: ${turn.end.error}`
								: ''}
						</p>
					{:else if turn.end?.status === 'stopped'}
						<p class="text-ui text-muted-foreground">Stopped.</p>
					{/if}
				{/each}
			{:else if session}
				<details class="min-w-0" open>
					<summary class="flex min-h-12 cursor-pointer items-center text-ui text-muted-foreground"
						>Activity</summary
					>
					{#if session.output}<pre
							class="max-h-96 overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-code [overflow-wrap:anywhere] whitespace-pre-wrap"
							aria-label="Raw output">{session.output}</pre>{:else}<p
							class="text-meta text-muted-foreground"
						>
							No output yet.
						</p>{/if}
				</details>
				{#if session.final}<div class="min-w-0 text-body" data-answer>
						<Markdown text={session.final} />
					</div>{/if}
			{/if}
			{#if session}
				{#each session.transcript ? placement.loose : requests as request (requestKey(request.id))}
					<ApprovalCard
						{request}
						{agent}
						{busy}
						submitting={submitting === requestKey(request.id)}
						ondecide={(decision) => onanswer(request.id, decision)}
					/>
				{/each}
				{#if session.error && !items?.some((t) => t.end?.error === session.error)}<p
						class="flex items-start gap-2 text-ui [overflow-wrap:anywhere] text-failed"
					>
						<CircleX class="mt-0.5 size-4 shrink-0" aria-hidden="true" />{session.error}
					</p>{/if}
				{#if session.deniedTools?.length}<p class="text-ui text-muted-foreground">
						Denied without asking: {session.deniedTools.join(', ')}. Allow them in the CLI's
						settings on the machine.
					</p>{/if}
				{#if status.group === 'finished' && session.status === 'completed'}<p
						class="text-meta text-muted-foreground"
					>
						Finished · Unverified: check the changes before relying on them.
					</p>{/if}
			{/if}
		</div>
	</div>
	<div class="shrink-0 border-t pb-[var(--safe-bottom)]" bind:this={composerBox}>
		{#if away && requests.length}<div class="flex justify-center px-4 pt-2">
				<Button variant="outline" onclick={review}
					><Hand />{requests.length === 1
						? '1 approval pending'
						: `${requests.length} approvals pending`} · Review</Button
				>
			</div>{/if}
		{#if actionError}<p role="alert" class="px-4 pt-2 text-sm [overflow-wrap:anywhere] text-failed">
				{actionError}
			</p>{/if}
		<Composer
			bind:value={draft}
			label="Message {agent.title}"
			sendLabel="Send to agent"
			{placeholder}
			attach={false}
			stop={false}
			unavailable={requests.length
				? 'Answer the approval first: the agent takes messages once it is answered.'
				: busy
					? 'Sending…'
					: undefined}
			onsend={() => void send()}
		/>
	</div>
</div>
