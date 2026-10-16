<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { closeShownNotifications } from '$lib/core/pwa/notifications';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import { MaintenanceScreen, maintenanceStore } from '$lib/features/maintenance';
	const store = maintenanceStore();
	$effect(() => {
		if (page.params.id)
			void closeShownNotifications(new Set([`maintenance:${page.params.id}`])).catch(() => {});
	});
	const proposal = $derived(store.remote.data?.view.proposals.find((p) => p.id === page.params.id));
	onMount(() => {
		store.error = null;
		void store.remote.refetch();
		const stop = store.remote.watch();
		const timer = setInterval(() => {
			if (!document.hidden && !store.busy) void store.remote.refetch();
		}, 15_000);
		return () => {
			stop();
			clearInterval(timer);
		};
	});
</script>

<svelte:head><title>Calendar update · sushii</title></svelte:head>
<MaintenanceScreen
	{proposal}
	remote={store.remote}
	busy={store.busy}
	error={store.error}
	enabled={store.remote.data?.view.responsibility.enabled ?? false}
	offline={!pwa.online}
	onretry={() => void store.remote.refetch()}
	onaction={(action) => void store.act(action)}
/>
