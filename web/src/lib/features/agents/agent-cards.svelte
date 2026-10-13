<script lang="ts">
	import { onMount } from 'svelte';
	import AgentRow from './components/agent-row.svelte';
	import { agentList } from './agents.svelte';
	import type { AgentRecord } from './api';
	let {
		conversationId,
		toolCallIds,
		onopen
	}: {
		conversationId: string;
		/** The chat's coding_agent calls in one message; each started agent shows as a card there. */
		toolCallIds: string[];
		onopen: (agent: AgentRecord, event: MouseEvent) => void;
	} = $props();
	const list = $derived(agentList(conversationId));
	const started = $derived(
		list.agents.filter((a) => a.toolCallId && toolCallIds.includes(a.toolCallId))
	);
	let now = $state(Date.now());
	$effect(() => list.watch());
	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(timer);
	});
</script>

{#if started.length}
	<ul class="flex min-w-0 flex-col gap-2" aria-label="Coding agents started here">
		{#each started as agent (agent.id)}<li>
				<AgentRow
					{agent}
					{now}
					card
					href={`/agents/${encodeURIComponent(agent.id)}`}
					onopen={(event) => onopen(agent, event)}
				/>
			</li>{/each}
	</ul>
{/if}
