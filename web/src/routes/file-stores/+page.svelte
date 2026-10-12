<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { backTo } from '$lib/core/nav/back';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import { FileStoresScreen } from '$lib/features/file-stores';
	let dirty = $state(false);
	beforeNavigate(({ cancel, willUnload }) => {
		if (!willUnload && dirty && !window.confirm('Discard unsaved file-store changes?')) cancel();
	});
	const goBack = backTo(resolve('/workspace'));
</script>

<svelte:head><title>File stores · sushii</title></svelte:head>
<FileStoresScreen
	back={{ href: resolve('/workspace'), label: 'Back', onclick: goBack }}
	online={pwa.online}
	ondirty={(value) => (dirty = value)}
/>
