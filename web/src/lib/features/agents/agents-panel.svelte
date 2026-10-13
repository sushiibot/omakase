<script lang="ts">
	import { onMount } from 'svelte';
	import AgentList from './components/agent-list.svelte';
	import AgentViewContainer from './agent-view.svelte';
	import { agentList } from './agents.svelte';
	import { unseen } from './seen';
	import type { AgentRecord } from './api';
	let {
		conversationId,
		selected = $bindable<string | undefined>(),
		docked,
		onnavigate
	}: {
		conversationId: string;
		/** The agent open in the panel; desktop only, phones open the agent's page. */
		selected?: string;
		docked: boolean;
		/** Leaves the panel for the agent's page on phones. */
		onnavigate: (href: string) => void;
	} = $props();
	let scope = $state<'conversation' | 'all'>('conversation');
	const list = $derived(agentList(scope === 'all' ? undefined : conversationId));
	let now = $state(Date.now());
	$effect(() => list.watch());
	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(timer);
	});
	const href = (agent: AgentRecord) => `/agents/${encodeURIComponent(agent.id)}`;
	function open(agent: AgentRecord, event: MouseEvent) {
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
		event.preventDefault();
		if (docked) selected = agent.id;
		else onnavigate(href(agent));
	}
</script>

{#if selected && docked}
	{#key selected}<AgentViewContainer
			id={selected}
			focusRequest
			pageHref={`/agents/${encodeURIComponent(selected)}`}
			onback={() => (selected = undefined)}
		/>{/key}
{:else}
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<AgentList
			agents={list.agents}
			{now}
			loading={list.loading}
			error={list.error}
			{scope}
			hrefFor={href}
			unread={(agent) => unseen(agent.id, agent.updatedAt)}
			onscope={(next) => (scope = next)}
			onopen={open}
			onretry={() => void list.refresh()}
		/>
	</div>
{/if}
