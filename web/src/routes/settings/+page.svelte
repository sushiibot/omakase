<script lang="ts">
	import { vault } from '$lib/core/native/vault.svelte';
	import { VaultSettings } from '$lib/features/settings';
	import { onMount } from 'svelte';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import { SettingsScreen, settingsStore } from '$lib/features/settings';

	const settings = settingsStore();
	onMount(() => settings.open());
</script>

<svelte:head><title>Settings · sushii</title></svelte:head>

{#snippet nativeSettings()}
	{#if vault.available}
		<VaultSettings
			folders={vault.folders}
			multipleFolders={vault.multipleFolders}
			markdownOnly={vault.markdownOnly}
			connected={vault.connected}
			busy={vault.busy}
			error={vault.error}
			onchoose={() => void vault.choose()}
			ondisconnect={(id) => void vault.disconnect(id)}
		/>
	{/if}
{/snippet}

<SettingsScreen
	{nativeSettings}
	me={settings.me}
	ownerName={settings.ownerName}
	nameSave={settings.nameSave}
	nameError={settings.nameError}
	push={settings.push}
	pushBusy={settings.pushBusy}
	pushError={settings.pushError}
	pushSyncFailed={pwa.pushSync === 'failed'}
	testBusy={settings.testBusy}
	testResult={settings.testResult}
	theme={settings.theme}
	version={__APP_VERSION__}
	standalone={pwa.standalone}
	canInstall={pwa.canInstall}
	installFailed={settings.installFailed}
	swError={pwa.swError}
	online={pwa.online}
	updateReady={!!pwa.waiting}
	onretryme={() => void settings.me.refetch()}
	onretryname={() => void settings.ownerName.refetch()}
	onsavename={(name) => void settings.saveName(name)}
	ontogglepush={() => void settings.togglePush()}
	ontest={() => void settings.sendTest()}
	onchoosetheme={(t) => settings.chooseTheme(t)}
	oninstall={() => void settings.install()}
	onreload={() => pwa.reload()}
/>
