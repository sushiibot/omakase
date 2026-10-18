<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import { FileStoresScreen } from '$lib/features/file-stores';
	let dirty = $state(false);
	beforeNavigate(({ cancel, willUnload }) => {
		if (!willUnload && dirty && !window.confirm('Discard unsaved file-store changes?')) cancel();
	});
</script>

<svelte:head><title>File stores · sushii</title></svelte:head>
<FileStoresScreen
	back={{ href: '/settings', label: 'Settings', desktop: false }}
	online={pwa.online}
	ondirty={(value) => (dirty = value)}
/>
