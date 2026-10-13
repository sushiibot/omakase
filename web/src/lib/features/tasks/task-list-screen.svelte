<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import TaskList from './task-list.svelte';
	let props: Omit<ComponentProps<typeof TaskList>, 'class'> = $props();
</script>

<DetailScreen title="Tasks">
	<ScreenContent>
		<TaskList {...props} />
	</ScreenContent>
</DetailScreen>
