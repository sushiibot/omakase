<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { chatStore } from '$lib/features/chat';
	import { onMount } from 'svelte';
	import { HttpError } from '$lib/core/http';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import { KeysScreen, integrationsApi, type Integration } from '$lib/features/integrations';
	let integrations = $state<Integration[]>([]);
	let loading = $state(true);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let notice = $state<string | null>(null);
	let continueId = $state<string | undefined>();
	async function guide(id?: string, resume = false) {
		if (busy || !pwa.online) return;
		busy = true;
		const service =
			id === 'google_maps' ? 'Google Maps' : id ? `the API integration ${id}` : 'a new API service';
		const prompt = resume
			? `I saved the credential for ${service} in the secure form. Check its live integration status and help me continue.`
			: `Guide me through connecting ${service}. Check current integration status, ask what I need, and walk me through setup one step at a time. Find the official links for me. Keep credentials in the secure form, never in chat.`;
		try {
			await goto(resolve('/chat'));
			await chatStore().send(prompt, [], { preserveComposer: true });
		} catch (err) {
			error = message(err);
		} finally {
			busy = false;
		}
	}
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
	async function update(id: string, key?: string, revision?: string) {
		if (busy) return;
		busy = true;
		error = null;
		notice = null;
		continueId = undefined;
		try {
			integrations = (
				await (key === undefined
					? integrationsApi.remove(id)
					: integrationsApi.save(id, key, revision))
			).integrations;
			continueId = key === undefined ? undefined : id;
			notice =
				key === undefined
					? 'Key removed.'
					: revision
						? 'Access approved and key saved. The key will be checked on first use.'
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

<svelte:head><title>API integrations · sushii</title></svelte:head>
<KeysScreen
	{integrations}
	{loading}
	{busy}
	{error}
	{notice}
	{continueId}
	onguide={(id, resume) => void guide(id, resume)}
	online={pwa.online}
	onretry={() => void refresh()}
	onsave={(id, key, revision) => update(id, key, revision)}
	onremove={(id) => update(id)}
/>
