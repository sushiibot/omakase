<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { MOBILE_BREAKPOINT } from '$lib/ui/breakpoints';
	import { settingsGroups } from '$lib/core/nav/settings';
	import { PreferencesScreen } from '$lib/features/settings';
	import SettingsNavigation from '$lib/ui/shell/settings-navigation.svelte';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	const desktop = new MediaQuery(`min-width: ${MOBILE_BREAKPOINT}px`);
	$effect(() => {
		if (desktop.current) void goto(resolve('/settings/preferences'), { replaceState: true });
	});
</script>

<svelte:head><title>Settings · sushii</title></svelte:head>
{#if desktop.current}
	<PreferencesScreen />
{:else}
	<DetailScreen title="Settings" back={{ href: '/chat', label: 'Back to app' }}>
		<ScreenContent><SettingsNavigation groups={settingsGroups} /></ScreenContent>
	</DetailScreen>
{/if}
