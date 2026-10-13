<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount, untrack } from 'svelte';
	import { getWorkspace } from '$lib/ui/workspace/context';
	import SplitWorkspace from '$lib/ui/workspace/split-workspace.svelte';
	import { agentList } from '$lib/features/agents';
	import TaskPanel from './task-panel.svelte';
	import { tasksStore } from './tasks.svelte';
	let {
		conversationId = 'main',
		initialSelectedId,
		open,
		tab = $bindable<'tasks' | 'agents'>('tasks'),
		agentId = $bindable<string | undefined>(),
		onopen,
		onclose,
		onnavigate,
		children
	}: {
		conversationId?: string;
		initialSelectedId?: string;
		open: boolean;
		/** The panel's tab and the agent open in it, so a notification link can open both. */
		tab?: 'tasks' | 'agents';
		agentId?: string;
		onopen: () => void;
		onclose: () => void;
		/** Leaves the panel for a page, such as an agent's on phones. */
		onnavigate?: (href: string) => void;
		/** toggle, open tasks, pending agent requests, whether the panel sits beside the chat. */
		children: Snippet<[() => void, number, number, boolean]>;
	} = $props();
	const workspace = getWorkspace();
	const store = tasksStore();
	// A conversation that is going away has no id; its agents are not fetched unfiltered.
	const agents = $derived(conversationId ? agentList(conversationId) : null);
	const waiting = $derived(agents?.pending ?? 0);
	let selectedId = $state<string | undefined>(untrack(() => initialSelectedId));
	let wide = $state(false);
	const docked = $derived(workspace ? workspace.docked : wide);
	const count = $derived(
		store.tasks.filter(
			(t) =>
				(t.sourceConversationId === conversationId || t.workConversationId === conversationId) &&
				t.status !== 'done' &&
				t.status !== 'cancelled'
		).length
	);
	onMount(() => {
		const query = matchMedia('(min-width: 1100px)');
		const sync = () => (wide = query.matches);
		sync();
		query.addEventListener('change', sync);
		const unwatch = store.watch();
		return () => {
			unwatch();
			query.removeEventListener('change', sync);
		};
	});
	$effect(() => agents?.watch());
	// Opening the panel while an agent waits on the owner lands on that tab.
	function toggle() {
		if (open) return onclose();
		if (waiting) tab = 'agents';
		onopen();
	}
	$effect(() =>
		workspace?.registerInspector({
			content: panel,
			get open() {
				return open;
			},
			onopen,
			onclose
		})
	);
</script>

{#snippet panel()}<TaskPanel
		{conversationId}
		bind:selectedId
		bind:tab
		bind:agentId
		{docked}
		{onnavigate}
		{onclose}
	/>{/snippet}
{#if workspace}
	{@render children(toggle, count, waiting, docked)}
{:else}
	<SplitWorkspace {open} {onopen} {onclose} {panel}
		>{@render children(toggle, count, waiting, docked)}</SplitWorkspace
	>
{/if}
