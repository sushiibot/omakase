<script lang="ts">
	import { Button } from '$lib/ui/button';
	import { Input } from '$lib/ui/input';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import Section from '$lib/ui/section/section.svelte';
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
		onsave: (id: string, key: string) => Promise<void>;
		onremove: (id: string) => Promise<void>;
	} = $props();
	const uid = $props.id();
	let key = $state('');
	let removing = $state(false);
	async function save(id: string) {
		const value = key;
		key = '';
		await onsave(id, value);
	}
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
				<Section id={`${uid}-${integration.id}`} title={integration.name}>
					<div class="flex flex-col gap-4">
						<div class="flex flex-col gap-1">
							<p class="text-sm">{integration.capability}</p>
							<p class="text-meta text-muted-foreground">
								{integration.source === 'environment'
									? 'Key configured in server environment'
									: integration.configured
										? 'Key saved on server'
										: 'Setup needed'}
							</p>
						</div>
						<ol class="list-decimal space-y-3 pl-5 text-sm">
							{#each integration.steps as step (step)}<li>{step}</li>{/each}
						</ol>
						<div class="flex flex-wrap gap-2">
							{#each integration.links as link (link.url)}
								<Button variant="outline" href={link.url} target="_blank" rel="noopener noreferrer"
									>{link.label}</Button
								>
							{/each}
						</div>
						<form
							class="flex flex-col gap-3"
							onsubmit={(event) => {
								event.preventDefault();
								if (online && !busy && key.trim()) void save(integration.id);
							}}
						>
							<label for={`${uid}-key`} class="text-sm font-medium"
								>{integration.configured ? 'Replacement API key' : 'API key'}</label
							>
							<Input
								id={`${uid}-key`}
								type="password"
								bind:value={key}
								autocomplete="off"
								autocapitalize="off"
								spellcheck={false}
								maxlength={256}
								disabled={busy || !online}
								aria-describedby={`${uid}-help`}
							/>
							<p id={`${uid}-help`} class="text-meta text-muted-foreground">
								Encrypted on your server. The agent can check setup status but cannot read this key.
								The field clears when you submit or leave this page.
							</p>
							<div class="flex flex-wrap gap-2">
								<Button type="submit" disabled={busy || !online || !key.trim()}
									>{busy ? 'Working…' : 'Save and test'}</Button
								>
								{#if integration.configured && integration.source !== 'environment'}<Button
										variant="ghost"
										disabled={busy || !online}
										onclick={() => (removing = !removing)}>Remove key</Button
									>{/if}
							</div>
						</form>
						{#if removing && integration.configured}
							<div class="flex flex-col gap-2">
								<p class="text-sm">
									Remove the saved key? Google Maps searches will need setup again.
								</p>
								<div class="flex gap-2">
									<Button variant="outline" disabled={busy} onclick={() => (removing = false)}
										>Keep key</Button
									>
									<Button
										variant="outline"
										disabled={busy || !online}
										onclick={async () => {
											await onremove(integration.id);
											removing = false;
										}}>Confirm removal</Button
									>
								</div>
							</div>
						{/if}
					</div>
				</Section>
			{/each}
		</div>
	</ScreenContent>
</DetailScreen>
