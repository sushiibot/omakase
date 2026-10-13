<script lang="ts">
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import FileStoresSection from './file-stores-section.svelte';
	let {
		back,
		online = true,
		ondirty
	}: {
		back?: { href: string; label: string; onclick?: (event: MouseEvent) => void };
		online?: boolean;
		ondirty?: (value: boolean) => void;
	} = $props();
</script>

{#snippet banner()}{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}{/snippet}
<DetailScreen title="File stores" {back} {banner}>
	<ScreenContent>
		<FileStoresSection heading="Connections" {ondirty} />
	</ScreenContent>
</DetailScreen>
