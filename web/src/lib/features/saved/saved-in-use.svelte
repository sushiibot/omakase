<script lang="ts">
	import { Button } from '$lib/ui/button';
	import { ItemGroup } from '$lib/ui/item';
	import Section from '$lib/ui/section/section.svelte';
	import SavedRow from './components/saved-row.svelte';
	import type { SavedItem } from './types';

	// Home's "In use": pinned items, running timers and open checklists, with a way to the library.
	let {
		items,
		now,
		titleOf
	}: {
		items: SavedItem[];
		now: number;
		titleOf: (conversationId: string) => string;
	} = $props();
</script>

{#if items.length}
	<Section title="In use" count={items.length}>
		{#snippet aside()}<Button href="/saved" variant="ghost">All saved</Button>{/snippet}
		<ItemGroup variant="bordered" data-saved-in-use>
			{#each items as item (item.id)}<div role="listitem">
					<SavedRow {item} {now} from={titleOf(item.conversationId)} />
				</div>{/each}
		</ItemGroup>
	</Section>
{/if}
