<script lang="ts">
	import { onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { FileStoresSection } from '$lib/features/file-stores';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import { SettingsScreen, settingsStore } from '$lib/features/settings';

	const settings = settingsStore();
	let fileStoresDirty = $state(false);
	beforeNavigate(({ cancel, willUnload }) => {
		if (!willUnload && fileStoresDirty && !window.confirm('Discard unsaved file-store changes?'))
			cancel();
	});

	onMount(() => settings.open());
</script>

<svelte:head><title>Settings · sushii</title></svelte:head>

<SettingsScreen
	me={settings.me}
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
	ontogglepush={() => void settings.togglePush()}
	ontest={() => void settings.sendTest()}
	onchoosetheme={(t) => settings.chooseTheme(t)}
	oninstall={() => void settings.install()}
	onreload={() => pwa.reload()}
>
	{#snippet fileStores()}<FileStoresSection
			ondirty={(value) => (fileStoresDirty = value)}
		/>{/snippet}
</SettingsScreen>
