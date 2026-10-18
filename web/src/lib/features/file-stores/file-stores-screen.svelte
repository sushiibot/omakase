<script lang="ts">
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import { PageIntro } from '$lib/ui/page';
	import FileStoresSection from './file-stores-section.svelte';
	let {
		back,
		online = true,
		ondirty
	}: {
		back?: {
			href: string;
			label: string;
			desktop?: boolean;
			onclick?: (event: MouseEvent) => void;
		};
		online?: boolean;
		ondirty?: (value: boolean) => void;
	} = $props();
</script>

{#snippet banner()}{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}{/snippet}
<DetailScreen title="File stores" {back} {banner}>
	<ScreenContent>
		<PageIntro description="Connect folders on your file server for the assistant to use." />
		<FileStoresSection heading="Connections" {ondirty} />
	</ScreenContent>
</DetailScreen>
