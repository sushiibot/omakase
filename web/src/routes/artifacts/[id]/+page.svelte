<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { Remote } from '$lib/core/remote.svelte';
	import { artifactsApi, ArtifactScreen, artifactVisits } from '$lib/features/artifacts';
	const remote = $derived.by(() => {
		const id = page.params.id ?? '';
		return new Remote(() => artifactsApi.get(id), { refetchOnFocus: true });
	});
	$effect(() => {
		const current = remote;
		untrack(() => void current.ensure());
		return current.watch();
	});
	$effect(() => {
		if (remote.data) artifactVisits().visit(remote.data.id);
	});
</script>

<svelte:head><title>Document · sushii</title></svelte:head>
<ArtifactScreen {remote} document={remote.data} onretry={() => void remote.refetch()} />
