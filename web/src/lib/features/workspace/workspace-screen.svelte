<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import UpdateToast from '$lib/ui/pwa/update-toast.svelte';
	import ListScreen from '$lib/ui/screen/list-screen.svelte';
	import type { NavItem } from '$lib/ui/shell/types';
	type WorkspaceEntry = NavItem & { feature?: string };

	let {
		entries,
		online = true,
		updateReady = false,
		onreload
	}: {
		entries: WorkspaceEntry[];
		online?: boolean;
		updateReady?: boolean;
		onreload?: () => void;
	} = $props();
	const sections = $derived(
		[
			{ label: 'Information and connections', items: entries.filter((entry) => !entry.feature) },
			{ label: 'Development previews', items: entries.filter((entry) => entry.feature) }
		].filter((section) => section.items.length)
	);
</script>

{#snippet banner()}
	{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}
{/snippet}
{#snippet toast()}<UpdateToast onreload={() => onreload?.()} />{/snippet}
{#snippet row(entry: WorkspaceEntry)}
	<a
		href={entry.href}
		class="flex min-h-16 items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-muted/60 motion-reduce:transition-none"
	>
		<entry.icon class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
		<span class="flex min-w-0 flex-1 flex-col gap-0.5">
			<span class="text-ui font-medium">{entry.label}</span>
			<span class="text-sm text-muted-foreground">{entry.description}</span>
		</span>
		<ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
	</a>
{/snippet}

<ListScreen
	title="Workspace"
	{banner}
	toast={updateReady ? toast : undefined}
	state={{ remote: { status: 'ready' } }}
	{sections}
	key={(entry) => entry.id}
	{row}
/>
