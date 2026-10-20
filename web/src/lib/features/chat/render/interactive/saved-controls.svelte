<script lang="ts">
	import Pin from '@lucide/svelte/icons/pin';
	import SquareArrowOutUpRight from '@lucide/svelte/icons/square-arrow-out-up-right';
	import { Button } from '$lib/ui/button';
	import type { LiveBlock } from '../../../../core/realtime/events';
	import type { SavedAccess } from '../rich/live';

	// Under a stored checklist, recipe or timer in chat: pin it (Home shows pinned items, and they
	// stay active), or open its own page. Quiet, so it never competes with the block.
	let { block, saved }: { block: LiveBlock; saved: SavedAccess } = $props();
	const pinned = $derived(saved.pinned(block.id));
</script>

<div class="-mt-0.5 flex items-center justify-end gap-2">
	<Button
		data-rich-control
		variant="ghost"
		size="xs"
		class={pinned ? 'text-foreground' : 'text-muted-foreground'}
		aria-pressed={pinned}
		title={pinned ? 'Unpin from Home' : 'Pin to Home'}
		onclick={() => saved.setPinned(block.id, !pinned)}><Pin aria-hidden="true" />Pin</Button
	>
	<Button
		data-rich-control
		variant="ghost"
		size="xs"
		class="text-muted-foreground"
		href={saved.href(block)}
		aria-label="Open {block.title}"><SquareArrowOutUpRight aria-hidden="true" />Open</Button
	>
</div>
