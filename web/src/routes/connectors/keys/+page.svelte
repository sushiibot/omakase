<script lang="ts">
	import { onMount } from 'svelte';
	import { HttpError } from '$lib/core/http';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import { KeysScreen, integrationsApi, type Integration } from '$lib/features/integrations';
	let integrations = $state<Integration[]>([]);
	let loading = $state(true);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let notice = $state<string | null>(null);
	function message(err: unknown) {
		if (
			err instanceof HttpError &&
			err.body &&
			typeof err.body === 'object' &&
			'error' in err.body &&
			typeof err.body.error === 'string'
		)
			return err.body.error;
		return err instanceof Error ? err.message : 'Could not update the key. Try again.';
	}
	async function refresh() {
		loading = true;
		error = null;
		try {
			integrations = (await integrationsApi.list()).integrations;
		} catch (err) {
			error = message(err);
		} finally {
			loading = false;
		}
	}
	async function update(id: string, key?: string) {
		if (busy) return;
		busy = true;
		error = null;
		notice = null;
		try {
			integrations = (
				await (key === undefined ? integrationsApi.remove(id) : integrationsApi.save(id, key))
			).integrations;
			notice =
				key === undefined
					? 'Key removed.'
					: 'Key tested and saved. Return to your conversation to continue.';
		} catch (err) {
			error = message(err);
		} finally {
			busy = false;
		}
	}
	onMount(() => {
		void refresh();
	});
</script>

<svelte:head><title>API keys · sushii</title></svelte:head>
<KeysScreen
	{integrations}
	{loading}
	{busy}
	{error}
	{notice}
	online={pwa.online}
	onretry={() => void refresh()}
	onsave={(id, key) => update(id, key)}
	onremove={(id) => update(id)}
/>
