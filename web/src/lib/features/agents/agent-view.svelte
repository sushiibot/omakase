<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import { Button } from '$lib/ui/button';
	import { conversationHref } from '$lib/core/nav/conversation';
	import AgentDetail from './components/agent-detail.svelte';
	import { AgentView } from './agents.svelte';
	import { agentState } from './model';
	import { markSeen } from './seen';
	let {
		id,
		focusRequest = false,
		pageHref,
		backLabel,
		onback
	}: {
		id: string;
		focusRequest?: boolean;
		pageHref?: string;
		backLabel?: string;
		/** Gets the agent's conversation once it is known. */
		onback: (conversationId?: string) => void;
	} = $props();
	const view = new AgentView(untrack(() => id));
	let now = $state(Date.now());
	onMount(() => {
		const stop = view.watch();
		const timer = setInterval(() => (now = Date.now()), 5000);
		return () => {
			stop();
			clearInterval(timer);
		};
	});
	const agent = $derived(view.detail?.agent);
	$effect(() => {
		if (agent && agentState(agent).group === 'finished') markSeen(agent.id, agent.updatedAt);
	});
</script>

{#if agent}
	<AgentDetail
		{agent}
		session={view.detail?.session}
		unavailable={view.detail?.unavailable ?? view.loadError}
		actionError={view.actionError}
		busy={view.busy}
		submitting={view.submitting}
		{now}
		{focusRequest}
		conversationHref={conversationHref(agent.conversationId)}
		{pageHref}
		{backLabel}
		onback={() => onback(agent.conversationId)}
		onstop={() => view.stop()}
		onanswer={(requestId, decision) => void view.answer(requestId, decision)}
		onmessage={(text) => view.message(text)}
	/>
{:else}
	<div class="flex min-h-0 flex-1 flex-col">
		<header class="flex min-h-13 shrink-0 items-center gap-1 border-b px-2 py-1">
			<Button
				variant="ghost"
				class="size-12 shrink-0 px-0"
				aria-label={backLabel ?? 'Back to agents'}
				onclick={() => onback()}><ChevronLeft /></Button
			>
			<h2 class="text-base font-semibold">Agent</h2>
		</header>
		<div class="flex flex-col items-start gap-2 px-4 py-4 text-sm">
			{#if view.loadError}<p role="alert" class="text-failed">{view.loadError}</p>
				<Button variant="outline" onclick={() => void view.refresh()}>Retry</Button>
			{:else}<p role="status" class="text-muted-foreground">Loading this agent…</p>{/if}
		</div>
	</div>
{/if}
