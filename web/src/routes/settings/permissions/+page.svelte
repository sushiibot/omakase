<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import { ToolPermissionsScreen, ToolPolicyStore } from '$lib/features/settings';
	const store = new ToolPolicyStore();
	onMount(() => {
		void store.load();
	});
</script>

<svelte:head><title>Tool permissions · sushii</title></svelte:head>
<ToolPermissionsScreen
	rules={store.rules}
	loaded={store.loaded}
	busy={store.busy}
	error={store.error}
	notice={store.notice}
	online={pwa.online}
	back={{ href: resolve('/settings'), label: 'Settings', desktop: false }}
	onretry={() => void store.load()}
	onsave={(rules) => void store.save(rules)}
/>
