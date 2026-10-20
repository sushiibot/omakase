<script lang="ts">
	import ListScreen from '$lib/ui/screen/list-screen.svelte';
	import type { RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import * as ToggleGroup from '$lib/ui/toggle-group';
	import SavedRow from './components/saved-row.svelte';
	import { groupSaved, SAVED_CHIPS, type SavedChip } from './model';
	import type { SavedItem, SavedStatus } from './types';

	// The library: what the agent made, found again by source conversation and status, never by
	// folder. Active by default, Pinned first, then one group per conversation.
	let {
		remote,
		items,
		chip = $bindable('all'),
		status = $bindable('active'),
		query = $bindable(''),
		titleOf,
		now,
		truncated = false,
		onretry
	}: {
		remote: RemoteLike;
		/** Already filtered to the chip, status and search. */
		items: SavedItem[];
		chip?: SavedChip;
		status?: SavedStatus;
		query?: string;
		titleOf: (conversationId: string) => string;
		now: number;
		truncated?: boolean;
		onretry: () => void;
	} = $props();
	const groups = $derived(groupSaved(items, titleOf));
	const filtered = $derived(chip !== 'all' || !!query.trim());
</script>

{#snippet lead()}
	<div class="flex flex-wrap items-center gap-2" data-saved-filters>
		<ToggleGroup.Root
			type="single"
			variant="outline"
			size="sm"
			aria-label="Kind"
			bind:value={() => chip, (next) => next && (chip = next as SavedChip)}
		>
			{#each SAVED_CHIPS as item (item.value)}<ToggleGroup.Item
					value={item.value}
					class="any-pointer-coarse:h-11">{item.label}</ToggleGroup.Item
				>{/each}
		</ToggleGroup.Root>
		<ToggleGroup.Root
			type="single"
			variant="outline"
			size="sm"
			aria-label="Status"
			class="ms-auto"
			bind:value={() => status, (next) => next && (status = next as SavedStatus)}
		>
			<ToggleGroup.Item value="active" class="any-pointer-coarse:h-11">Active</ToggleGroup.Item>
			<ToggleGroup.Item value="done" class="any-pointer-coarse:h-11">Done</ToggleGroup.Item>
		</ToggleGroup.Root>
	</div>
{/snippet}
{#snippet row(entry: { item: SavedItem; group: string })}
	<SavedRow
		item={entry.item}
		{now}
		from={entry.group === 'pinned' ? titleOf(entry.item.conversationId) : undefined}
	/>
{/snippet}
{#snippet after()}{#if truncated}<p class="text-meta text-muted-foreground">
			Showing the most recent saved items.
		</p>{/if}{/snippet}
<ListScreen
	title="Saved"
	bind:search={query}
	searchLabel="Search saved items"
	{lead}
	sections={groups.map((g) => ({
		label: g.label,
		items: g.items.map((item) => ({ item, group: g.id }))
	}))}
	key={(entry) => `${entry.group}:${entry.item.id}`}
	{row}
	{after}
	state={{
		remote,
		onretry,
		errorTitle: "Couldn't load saved items.",
		empty: {
			title: filtered
				? 'No matching items'
				: status === 'done'
					? 'Nothing done yet'
					: 'Nothing saved yet',
			body: filtered
				? 'Try another search or filter.'
				: status === 'done'
					? 'Finished lists and timers, and items left unused for a while, move here.'
					: 'Documents, checklists, recipes and timers the agent makes in chat appear here.'
		}
	}}
/>
