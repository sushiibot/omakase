<script lang="ts">
	import { deviceFs } from '$lib/core/native/device-fs.svelte';
	import { DeviceFsSettings } from '$lib/features/settings';
	import { onMount } from 'svelte';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import { SettingsScreen, settingsStore } from '$lib/features/settings';

	const settings = settingsStore();
	onMount(() => settings.open());
</script>

<svelte:head><title>Settings · sushii</title></svelte:head>

{#snippet nativeSettings()}
	{#if deviceFs.available}
		<DeviceFsSettings
			folders={deviceFs.folders}
			multipleFolders={deviceFs.multipleFolders}
			markdownOnly={deviceFs.markdownOnly}
			connected={deviceFs.connected}
			busy={deviceFs.busy}
			error={deviceFs.error}
			onchoose={() => void deviceFs.choose()}
			ondisconnect={(id) => void deviceFs.disconnect(id)}
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
	onretryme={() => void settings.me.refetch()}
	onretryname={() => void settings.ownerName.refetch()}
	onsavename={(name) => void settings.saveName(name)}
	ontogglepush={() => void settings.togglePush()}
	ontest={() => void settings.sendTest()}
	onchoosetheme={(t) => settings.chooseTheme(t)}
	oninstall={() => void settings.install()}
	onreload={() => pwa.reload()}
/>
