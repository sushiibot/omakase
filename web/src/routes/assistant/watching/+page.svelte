<script lang="ts">
	import { onMount } from 'svelte';
	import { MaintenanceSummary, maintenanceStore } from '$lib/features/maintenance';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';

	// The full responsibility lives here; Home shows it only when its last review failed.
	const store = maintenanceStore();
	const view = $derived(store.remote.data?.view);
	onMount(() => {
		store.error = null;
		void store.remote.refetch();
		return store.remote.watch();
	});
</script>

<svelte:head><title>Calendar upkeep · sushii</title></svelte:head>
<DetailScreen
	title="Calendar upkeep"
	back={{ href: '/assistant', label: 'Home' }}
	hasContent={!!view}
	state={{
		remote: store.remote,
		isEmpty: !view && store.remote.status === 'ready',
		onretry: () => void store.remote.refetch(),
		errorTitle: "Couldn't load calendar upkeep.",
		empty: { title: 'Nothing set up', body: 'Calendar upkeep appears here once it is set up.' }
	}}
>
	<ScreenContent measure="reading">
		<MaintenanceSummary
			mode="watching"
			{view}
			busy={store.busy}
			error={store.error}
			onpause={(paused) => void store.act({ action: 'pause', paused })}
		/>
	</ScreenContent>
</DetailScreen>
