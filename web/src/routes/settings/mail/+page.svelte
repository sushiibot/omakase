<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { backTo } from '$lib/core/nav/back';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import { MailScreen, MailStore } from '$lib/features/mail';
	const store = new MailStore();
	const back = backTo(resolve('/workspace/agent-settings'));
	onMount(() => {
		const outcome = page.url.searchParams.get('connection');
		if (outcome === 'connected') store.notice = 'Mail account connected.';
		else if (outcome === 'failed')
			store.notice = 'Sign-in did not complete. Try connecting the account again.';
		void store.load();
	});
</script>

<svelte:head><title>Mail accounts · sushii</title></svelte:head>
<MailScreen
	accounts={store.accounts}
	providers={store.providers}
	loaded={store.loaded}
	busy={store.busy}
	error={store.error}
	notice={store.notice}
	online={pwa.online}
	back={{ href: resolve('/workspace/agent-settings'), label: 'Agent settings', onclick: back }}
	onretry={() => void store.load()}
	onsave={(input) => store.save(input)}
	onremove={(id) => void store.remove(id)}
/>
