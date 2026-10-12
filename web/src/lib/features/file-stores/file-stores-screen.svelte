<script lang="ts">
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
	<div class="mx-auto flex max-w-2xl flex-col gap-5 px-4 pt-4 pb-10">
		<FileStoresSection heading="Connections" {ondirty} />
	</div>
</DetailScreen>
