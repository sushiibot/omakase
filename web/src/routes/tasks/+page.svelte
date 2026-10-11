<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { TaskPanel, tasksStore } from '$lib/features/tasks';
	onMount(() => tasksStore().watch());
</script>

<svelte:head><title>Tasks · sushii</title></svelte:head>
<TaskPanel fullPage onselect={(id) => void goto(resolve('/tasks/[id]', { id }))} />
