<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import { SchedulesScreen, schedulesStore } from '$lib/features/schedules';

	const list = schedulesStore().list;
	let now = $state(Date.now());

	onMount(() => {
		void list.ensure();
		const unwatch = list.watch();
		const t = setInterval(() => (now = Date.now()), 30_000);
		return () => {
			clearInterval(t);
			unwatch();
		};
	});
</script>

<svelte:head><title>Schedules · sushii</title></svelte:head>

<SchedulesScreen
	remote={list}
	jobs={list.data ?? []}
	{now}
	online={pwa.online}
	jobHref={(id) => resolve('/schedules/[id]', { id })}
	onretry={() => void list.refetch()}
/>
