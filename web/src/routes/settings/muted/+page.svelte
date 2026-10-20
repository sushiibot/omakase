<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import { MutedScreen, MutedStore } from '$lib/features/home';
	const store = new MutedStore();
	onMount(() => void store.load());
</script>

<svelte:head><title>Muted topics · sushii</title></svelte:head>
<MutedScreen
	mutes={store.mutes}
	loaded={store.loaded}
	busy={store.busy}
	error={store.error}
	lifted={store.lifted}
	online={pwa.online}
	now={Date.now()}
	back={{ href: resolve('/settings'), label: 'Settings', desktop: false }}
	onretry={() => void store.load()}
	onunmute={(mute) => void store.unmute(mute)}
/>
