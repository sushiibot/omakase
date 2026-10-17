<!-- app: persistent web and Android update status with explicit actions (ux-guidelines.md#notifications) -->
<script lang="ts">
	import { Button } from '$lib/ui/button';
	import { Spinner } from '$lib/ui/spinner';

	let {
		webState,
		webError,
		androidVersion,
		androidUrl,
		androidSupported = false,
		androidBusy = false,
		androidError,
		permissionRequired = false,
		onreload,
		onretry,
		oninstall
	}: {
		webState: 'idle' | 'downloading' | 'ready' | 'failed';
		webError?: string | null;
		androidVersion?: string;
		androidUrl?: string;
		androidSupported?: boolean;
		androidBusy?: boolean;
		androidError?: string | null;
		permissionRequired?: boolean;
		onreload: () => void;
		onretry: () => void;
		oninstall: () => void;
	} = $props();
</script>

{#if webState !== 'idle' || androidVersion}
	<div class="shrink-0 border-b bg-muted px-4 text-sm" aria-label="App updates">
		{#if webState !== 'idle'}
			<div class="flex min-h-12 items-center gap-3">
				<span class="flex flex-1 items-center gap-2" role="status">
					{#if webState === 'downloading'}<Spinner class="size-4" />Downloading web update…
					{:else if webState === 'failed'}{webError ?? 'Could not download the web update.'}
					{:else}Web update ready{/if}
				</span>
				{#if webState === 'ready'}<Button variant="ghost" onclick={onreload}>Reload</Button>
				{:else if webState === 'failed'}<Button variant="ghost" onclick={onretry}>Retry</Button
					>{/if}
			</div>
		{/if}
		{#if androidVersion}
			<div class="flex min-h-12 items-center gap-3">
				<span class="flex flex-1 items-center gap-2" role="status">
					{#if androidBusy}<Spinner class="size-4" />Downloading Android update…
					{:else if androidError}{androidError}
					{:else if permissionRequired}Allow installs, then tap Install update again.
					{:else}Android {androidVersion} available{/if}
				</span>
				{#if androidSupported}
					<Button variant="ghost" disabled={androidBusy} onclick={oninstall}>Install update</Button>
				{:else if androidUrl}
					<Button variant="ghost" href={androidUrl} target="_blank" rel="noopener"
						>Download APK</Button
					>
				{/if}
			</div>
		{/if}
	</div>
{/if}
