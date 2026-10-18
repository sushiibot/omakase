<script lang="ts">
	import { Button } from '$lib/ui/button';
	import KeyEntry from './key-entry.svelte';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import type { Integration } from './types';
	let {
		integrations,
		loading,
		busy,
		error,
		notice,
		online,
		onretry,
		onsave,
		onremove
	}: {
		integrations: Integration[];
		loading: boolean;
		busy: boolean;
		error: string | null;
		notice: string | null;
		online: boolean;
		onretry: () => void;
		onsave: (id: string, key: string, revision?: string) => Promise<void>;
		onremove: (id: string) => Promise<void>;
	} = $props();
</script>

{#snippet banner()}
	{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}
{/snippet}
<DetailScreen title="API keys" back={{ href: '/connectors', label: 'Connectors' }} {banner}>
	<ScreenContent>
		<div class="flex flex-col gap-6">
			<p class="text-sm text-muted-foreground">
				Save keys here so your agent can use connected services. Keys stay on your server and are
				never added to chat.
			</p>
			{#if error}<div role="alert" class="flex flex-col items-start gap-2">
					<p class="text-sm text-failed">{error}</p>
					<Button variant="outline" disabled={busy || !online} onclick={onretry}
						>Refresh status</Button
					>
				</div>{/if}
			{#if notice}<p role="status" class="text-sm">{notice}</p>{/if}
			{#if loading}<p role="status" class="text-sm text-muted-foreground">
					Loading integrations…
				</p>{/if}
			{#each integrations as integration (integration.id)}
				<KeyEntry {integration} {busy} {online} {onsave} {onremove} />
			{/each}
		</div>
	</ScreenContent>
</DetailScreen>
