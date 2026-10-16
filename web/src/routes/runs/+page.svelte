<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import { RunListScreen, runsStore } from '$lib/features/runs';

	const runs = runsStore();
	const list = runs.list;
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

<svelte:head><title>Activity · sushii</title></svelte:head>

<RunListScreen
	remote={list}
	runs={[...(list.data?.runs ?? []), ...runs.older]}
	{now}
	hasOlder={!!runs.before}
	olderLoading={runs.olderLoading}
	olderError={runs.olderError}
	truncated={runs.truncated}
	online={pwa.online}
	runHref={(id) => resolve('/runs/[id]', { id })}
	historyHref={resolve('/history')}
	filter={runs.filter}
	onfilter={(f) => runs.setFilter(f)}
	onretry={() => void list.refetch()}
	onloadolder={() => void runs.loadOlder()}
/>
