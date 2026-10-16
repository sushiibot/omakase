<script lang="ts">
	import Section from '$lib/ui/section/section.svelte';
	import { Button } from '$lib/ui/button';
	let {
		name,
		connected,
		busy,
		error,
		onchoose,
		ondisconnect
	}: {
		name?: string;
		connected: boolean;
		busy: boolean;
		error?: string;
		onchoose: () => void;
		ondisconnect: () => void;
	} = $props();
</script>

<Section id="vault" title="Obsidian vault">
	<div class="flex flex-col items-start gap-2">
		<p class="text-sm">{name ?? 'No folder connected'}</p>
		<p class="max-w-prose text-sm text-muted-foreground" role="status">
			{#if connected}Ready for the agent to read and edit Markdown notes while this app is open.
			{:else if name}Vault access is paused. Keep the app open and connected to resume.
			{:else}Choose your vault to let the agent read and edit its Markdown notes while this app is
				open.{/if}
		</p>
		<div class="flex flex-wrap gap-2">
			<Button variant="outline" disabled={busy} onclick={onchoose}
				>{busy ? 'Please wait…' : name ? 'Change folder' : 'Connect vault'}</Button
			>
			{#if name}<Button variant="ghost" disabled={busy} onclick={ondisconnect}
					>Disconnect vault</Button
				>{/if}
		</div>
		{#if error}<p class="text-sm text-failed" role="alert">{error}</p>{/if}
	</div>
</Section>
