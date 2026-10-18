<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import { ConnectorsScreen, connectorsStore } from '$lib/features/connectors';

	const list = connectorsStore().list;
	onMount(() => {
		void list.ensure();
		return list.watch();
	});
</script>

<svelte:head><title>MCP servers · sushii</title></svelte:head>

<ConnectorsScreen
	back={{ href: resolve('/settings'), label: 'Settings', desktop: false }}
	remote={list}
	servers={list.data ?? []}
	online={pwa.online}
	serverHref={(id) => resolve('/connectors/[id]', { id })}
	addHref={resolve('/connectors/add')}
	onretry={() => void list.refetch()}
/>
