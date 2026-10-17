<script lang="ts">
	import Section from '$lib/ui/section/section.svelte';
	import { Button } from '$lib/ui/button';
	let {
		folders,
		multipleFolders = false,
		markdownOnly = false,
		connected,
		busy,
		error,
		onchoose,
		ondisconnect
	}: {
		folders: { id: string; name: string; available: boolean }[];
		multipleFolders?: boolean;
		markdownOnly?: boolean;
		connected: boolean;
		busy: boolean;
		error?: string;
		onchoose: () => void;
		ondisconnect: (id: string) => void;
	} = $props();
</script>

<Section id="local-files" title="Device files">
	<div class="flex flex-col gap-3">
		<p class="max-w-prose text-sm text-muted-foreground" role="status">
			{#if connected}Ready for the agent to read, create, and update files in these folders while
				this app is open.
			{:else if folders.length}File access is paused. Keep the app open and connected to resume.
			{:else}Add folders to let the agent read, create, and update their files while this app is
				open.{/if}
		</p>
		{#if folders.length}
			<ul class="flex flex-col divide-y divide-border">
				{#each folders as folder (folder.id)}
					<li class="flex flex-wrap items-center justify-between gap-2 py-2">
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium break-all">{folder.name}</p>
							{#if !folder.available}<p class="text-sm text-muted-foreground">
									Permission lost. Add this folder again to reconnect.
								</p>{/if}
						</div>
						<Button
							variant="ghost"
							disabled={busy}
							aria-label={`Disconnect ${folder.name}`}
							onclick={() => ondisconnect(folder.id)}>Disconnect</Button
						>
					</li>
				{/each}
			</ul>
		{:else}<p class="text-sm">No folders connected</p>{/if}
		{#if !multipleFolders}<p class="text-sm text-muted-foreground">
				{#if markdownOnly}This app version supports one Markdown folder. Install the latest APK for
					multiple folders and other file types.
				{:else}Install the latest APK to connect multiple folders.{/if}
			</p>{/if}
		<div>
			<Button variant="outline" disabled={busy} onclick={onchoose}
				>{busy
					? 'Please wait…'
					: !multipleFolders && folders.length
						? 'Change folder'
						: 'Add folder'}</Button
			>
		</div>
		{#if error}<p class="text-sm text-failed" role="alert">{error}</p>{/if}
	</div>
</Section>
