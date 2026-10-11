<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import SplitWorkspace from '$lib/ui/workspace/split-workspace.svelte';
	import TaskPanel from './task-panel.svelte';
	import { tasksStore } from './tasks.svelte';
	let {
		conversationId = 'main',
		open,
		onopen,
		onclose,
		children
	}: {
		conversationId?: string;
		open: boolean;
		onopen: () => void;
		onclose: () => void;
		children: Snippet<[() => void, number]>;
	} = $props();
	const store = tasksStore();
	let selectedId = $state<string | undefined>();
	const count = $derived(
		store.tasks.filter(
			(t) =>
				(t.sourceConversationId === conversationId || t.workConversationId === conversationId) &&
				t.status !== 'done' &&
				t.status !== 'cancelled'
		).length
	);
	onMount(() => store.watch());
</script>

{#snippet panel()}<TaskPanel {conversationId} bind:selectedId {onclose} />{/snippet}
<SplitWorkspace {open} {onopen} {onclose} {panel}
	>{@render children(() => (open ? onclose() : onopen()), count)}</SplitWorkspace
>
