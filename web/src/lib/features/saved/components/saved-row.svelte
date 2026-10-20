<script lang="ts" module>
	import FileText from '@lucide/svelte/icons/file-text';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import CookingPot from '@lucide/svelte/icons/cooking-pot';
	import TimerIcon from '@lucide/svelte/icons/timer';
	import type { SavedKind } from '../types';

	export const KIND_ICON: Record<SavedKind, typeof FileText> = {
		document: FileText,
		checklist: ListChecks,
		recipe: CookingPot,
		timer: TimerIcon
	};
</script>

<script lang="ts">
	import Pin from '@lucide/svelte/icons/pin';
	import * as Item from '$lib/ui/item';
	import { ago } from '$lib/ui/format/time';
	import { KIND_LABEL, savedHref, stateLine } from '../model';
	import type { SavedItem } from '../types';

	// One saved item: kind icon, title, its state, and where it came from. The whole row opens the
	// item's page; actions live there, so nothing nests inside the link.
	let {
		item,
		now,
		from
	}: {
		item: SavedItem;
		now: number;
		/** The source conversation's name; left out where the list is already that conversation's. */
		from?: string;
	} = $props();
	const Icon = $derived(KIND_ICON[item.kind]);
</script>

<Item.Root size="sm">
	{#snippet child({ props })}
		<a href={savedHref(item)} {...props} data-saved-row={item.id}>
			<Item.Media variant="icon">
				<Icon class="text-muted-foreground" aria-hidden="true" />
			</Item.Media>
			<Item.Content class="min-w-0">
				<Item.Title class="w-full min-w-0">
					<span class="truncate">{item.title}</span>
					{#if item.pinned}<Pin
							class="size-3.5 shrink-0 text-muted-foreground"
							aria-label="Pinned"
						/>{/if}
				</Item.Title>
				<Item.Description class="truncate">
					<span class="sr-only">{KIND_LABEL[item.kind]}: </span>{stateLine(item, now) ||
						KIND_LABEL[item.kind]}
				</Item.Description>
				<Item.Description class="truncate text-xs">
					{[from && `From ${from}`, item.archived && 'Archived', ago(item.updatedAt, now)]
						.filter(Boolean)
						.join(' · ')}
				</Item.Description>
			</Item.Content>
		</a>
	{/snippet}
</Item.Root>
