<script lang="ts">
	import { onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { AccountsScreen, createAccounts } from '$lib/features/accounts';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	const model = createAccounts();
	beforeNavigate(() => model.hide());
	onMount(() => {
		void model.refresh();
		return () => model.dispose();
	});
</script>

<svelte:head><title>Accounts · sushii</title></svelte:head>
<svelte:document
	onvisibilitychange={() => {
		if (document.hidden) model.hide();
	}}
/>
<svelte:window onpagehide={() => model.hide()} />
<AccountsScreen
	accounts={model.accounts}
	loading={model.loading}
	busy={model.busy}
	error={model.error}
	notice={model.notice}
	secret={model.secret}
	online={pwa.online}
	historyId={model.historyId}
	events={model.events}
	historyLoading={model.historyLoading}
	historyError={model.historyError}
	onrefresh={() => void model.refresh()}
	onreveal={(a, purpose, version) => void model.reveal(a, purpose, version)}
	onhide={model.hide}
	onarchive={(a) => void model.archive(a)}
	onhistory={(id) => (id ? void model.history(id) : model.closeHistory())}
/>
