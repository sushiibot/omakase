<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { TaskPanel, tasksStore } from '$lib/features/tasks';
	const store = tasksStore();
	let selectedId = $derived(page.params.id);
	onMount(() => store.watch());
</script>

<svelte:head
	><title>{store.tasks.find((t) => t.id === selectedId)?.title ?? 'Task'} · sushii</title
	></svelte:head
>
<TaskPanel {selectedId} fullPage onclose={() => void goto(resolve('/tasks'))} />
