<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount, untrack } from 'svelte';
	import { getWorkspace } from '$lib/ui/workspace/context';
	import SplitWorkspace from '$lib/ui/workspace/split-workspace.svelte';
	import TaskPanel from './task-panel.svelte';
	import { tasksStore } from './tasks.svelte';
	let {
		conversationId = 'main',
		initialSelectedId,
		open,
		onopen,
		onclose,
		children
	}: {
		conversationId?: string;
		initialSelectedId?: string;
		open: boolean;
		onopen: () => void;
		onclose: () => void;
		children: Snippet<[() => void, number]>;
	} = $props();
	const workspace = getWorkspace();
	const store = tasksStore();
	let selectedId = $state<string | undefined>(untrack(() => initialSelectedId));
	const count = $derived(
		store.tasks.filter(
			(t) =>
				(t.sourceConversationId === conversationId || t.workConversationId === conversationId) &&
				t.status !== 'done' &&
				t.status !== 'cancelled'
		).length
	);
	onMount(() => store.watch());
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

{#snippet panel()}<TaskPanel {conversationId} bind:selectedId {onclose} />{/snippet}
{#if workspace}
	{@render children(() => (open ? onclose() : onopen()), count)}
{:else}
	<SplitWorkspace {open} {onopen} {onclose} {panel}
		>{@render children(() => (open ? onclose() : onopen()), count)}</SplitWorkspace
	>
{/if}
