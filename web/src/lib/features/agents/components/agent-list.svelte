<script lang="ts">
	import Bot from '@lucide/svelte/icons/bot';
	import { Button } from '$lib/ui/button';
	import Section from '$lib/ui/section/section.svelte';
	import AgentRow from './agent-row.svelte';
	import { groupAgents, type AgentGroup } from '../model';
	import type { AgentRecord } from '../types';
	let {
		agents,
		now,
		loading = false,
		error = null,
		scope,
		hrefFor,
		unread = () => false,
		onscope,
		onopen,
		onretry
	}: {
		agents: AgentRecord[];
		now: number;
		loading?: boolean;
		error?: string | null;
		/** `conversation` lists this conversation's agents; `all` every agent. */
		scope?: 'conversation' | 'all';
		hrefFor: (agent: AgentRecord) => string;
		unread?: (agent: AgentRecord) => boolean;
		onscope?: (scope: 'conversation' | 'all') => void;
		onopen?: (agent: AgentRecord, event: MouseEvent) => void;
		onretry?: () => void;
	} = $props();
	const FINISHED_PAGE = 20;
	let finishedShown = $state(FINISHED_PAGE);
	const groups = $derived(groupAgents(agents));
	const sections: { group: AgentGroup; title: string }[] = [
		{ group: 'needs-you', title: 'Needs you' },
		{ group: 'working', title: 'Working' },
		{ group: 'finished', title: 'Finished' }
	];
</script>

<div class="flex flex-col gap-5 px-2 py-4" data-agent-list>
	{#if scope && onscope}<div class="flex px-2">
			<Button
				variant="ghost"
				class="-ml-3"
				aria-pressed={scope === 'all'}
				onclick={() => onscope(scope === 'all' ? 'conversation' : 'all')}
				>{scope === 'all' ? 'Show this conversation only' : 'Show all conversations'}</Button
			>
		</div>{/if}
	{#if error}<div role="alert" class="flex flex-col items-start gap-2 px-2 text-sm text-failed">
			<p>Could not load agents. {error}</p>
			{#if onretry}<Button variant="outline" onclick={onretry}>Reload agents</Button>{/if}
		</div>{/if}
	{#if loading && !agents.length}<p role="status" class="px-2 text-sm text-muted-foreground">
			Loading agents…
		</p>
	{:else if !agents.length && !error}<div
			class="flex flex-col items-center gap-3 px-4 py-12 text-center"
		>
			<Bot class="size-8 text-muted-foreground" aria-hidden="true" />
			<p class="font-medium">
				{scope === 'all' ? 'No coding agents yet' : 'No coding agents in this conversation'}
			</p>
			<p class="max-w-64 text-sm text-muted-foreground">
				Ask Sushii to start a Codex or Claude Code agent on your computer. It shows here while it
				works.
			</p>
		</div>{/if}
	{#each sections as { group, title } (group)}
		{@const rows = group === 'finished' ? groups.finished.slice(0, finishedShown) : groups[group]}
		{#if groups[group].length}
			<Section {title} tone="list" count={groups[group].length}>
				<ul class="flex flex-col">
					{#each rows as agent (agent.id)}<li>
							<AgentRow
								{agent}
								{now}
								href={hrefFor(agent)}
								unread={group === 'finished' && unread(agent)}
								onopen={onopen ? (event) => onopen(agent, event) : undefined}
							/>
						</li>{/each}
				</ul>
				{#if group === 'finished' && groups.finished.length > finishedShown}<Button
						variant="ghost"
						class="self-start"
						onclick={() => (finishedShown += FINISHED_PAGE)}>Show older</Button
					>{/if}
			</Section>
		{/if}
	{/each}
</div>
