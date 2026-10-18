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
		onremove,
		onguide,
		continueId
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
		onguide: (id?: string, resume?: boolean) => void;
		continueId?: string;
	} = $props();
</script>

{#snippet banner()}
	{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}
{/snippet}
<DetailScreen
	title="API integrations"
	back={{ href: '/settings', label: 'Settings', desktop: false }}
	{banner}
>
	<ScreenContent>
		<div class="flex flex-col gap-6">
			<p class="text-sm text-muted-foreground">
				Start with the agent. It will find the setup instructions and guide you through connecting a
				service. Use this page only to review access and save keys securely.
			</p>
			<div>
				<Button disabled={busy || !online} onclick={() => onguide()}>Connect a service</Button>
			</div>
			{#if error}<div role="alert" class="flex flex-col items-start gap-2">
					<p class="text-sm text-failed">{error}</p>
					<Button variant="outline" disabled={busy || !online} onclick={onretry}
						>Refresh status</Button
					>
				</div>{/if}
			{#if notice}<p role="status" class="text-sm">{notice}</p>{/if}
			{#if continueId}<div>
					<Button disabled={busy || !online} onclick={() => onguide(continueId, true)}
						>Continue with agent</Button
					>
				</div>{/if}
			{#if loading}<p role="status" class="text-sm text-muted-foreground">
					Loading integrations…
				</p>{/if}
			{#each [...integrations].sort((a, b) => Number(!a.operations) - Number(!b.operations)) as integration (integration.id)}
				<KeyEntry {integration} {busy} {online} {onsave} {onremove} {onguide} />
			{/each}
		</div>
	</ScreenContent>
</DetailScreen>
