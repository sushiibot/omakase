<script lang="ts">
	import { untrack } from 'svelte';
	import { Remote } from '$lib/core/remote.svelte';
	import { artifactsApi, ArtifactsScreen } from '$lib/features/artifacts';
	let query = $state('');
	let committedQuery = '';
	const remote = new Remote(() => artifactsApi.list(committedQuery), { refetchOnFocus: true });
	$effect(() => {
		const value = query;
		const timer = setTimeout(() => {
			committedQuery = value;
			void remote.refetch();
		}, 200);
		return () => clearTimeout(timer);
	});
	$effect(() => untrack(() => remote.watch()));
</script>

<svelte:head><title>Artifacts · sushii</title></svelte:head>
<ArtifactsScreen {remote} data={remote.data} bind:query onretry={() => void remote.refetch()} />
