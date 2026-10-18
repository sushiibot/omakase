<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import * as Item from '$lib/ui/item';
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
			{ label: 'Information', items: entries.filter((entry) => !entry.feature) },
			{ label: 'Development previews', items: entries.filter((entry) => entry.feature) }
		].filter((section) => section.items.length)
	);
</script>

{#snippet banner()}
	{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}
{/snippet}
{#snippet toast()}<UpdateToast onreload={() => onreload?.()} />{/snippet}
{#snippet row(entry: WorkspaceEntry)}
	<Item.Root size="sm">
		{#snippet child({ props })}
			<a href={entry.href} {...props}>
				<Item.Media variant="icon">
					<entry.icon class="text-muted-foreground" aria-hidden="true" />
				</Item.Media>
				<Item.Content class="min-w-0">
					<Item.Title>{entry.label}</Item.Title>
					<Item.Description>{entry.description}</Item.Description>
				</Item.Content>
				<Item.Actions>
					<ChevronRight class="size-4 text-muted-foreground" aria-hidden="true" />
				</Item.Actions>
			</a>
		{/snippet}
	</Item.Root>
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
