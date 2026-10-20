<script lang="ts">
	import type { Snippet } from 'svelte';
	import Archive from '@lucide/svelte/icons/archive';
	import ArchiveRestore from '@lucide/svelte/icons/archive-restore';
	import Pin from '@lucide/svelte/icons/pin';
	import { Button } from '$lib/ui/button';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import type { RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import { KIND_LABEL } from './model';
	import type { SavedItem, SavedKind } from './types';

	// One saved item: what it is, where it came from (a link to the reply that made it), pin and
	// archive, and the item itself, which the caller renders (a document, or the live block).
	let {
		kind,
		title,
		item,
		remote,
		fromTitle,
		fromHref,
		date,
		found = false,
		busy = false,
		error,
		onpin,
		onarchive,
		onretry,
		children
	}: {
		kind: SavedKind;
		/** The item's title, known before its saved record loads (a document's own title). */
		title?: string;
		/** The saved record: pin, archive and status; absent while loading or when unavailable. */
		item?: SavedItem | null;
		remote: RemoteLike;
		fromTitle?: string;
		fromHref?: string;
		/** When it was made, as shown in the provenance line. */
		date?: string;
		/** The item itself loaded: show it, and keep it through refreshes. */
		found?: boolean;
		busy?: boolean;
		error?: string | null;
		onpin: (pinned: boolean) => void;
		onarchive: (archived: boolean) => void;
		onretry: () => void;
		/** The item itself, shown once `found`. */
		children?: Snippet;
	} = $props();
	const name = $derived(title ?? item?.title ?? KIND_LABEL[kind]);
</script>

{#snippet actions()}
	{#if item}
		<Button
			variant="ghost"
			size="sm"
			aria-pressed={item.pinned}
			disabled={busy}
			class={item.pinned ? 'text-foreground' : 'text-muted-foreground'}
			title={item.pinned ? 'Unpin from Home' : 'Pin to Home'}
			onclick={() => onpin(!item.pinned)}><Pin aria-hidden="true" />Pin</Button
		>
		{#if item.archived}<Button
				variant="ghost"
				size="sm"
				disabled={busy}
				onclick={() => onarchive(false)}><ArchiveRestore aria-hidden="true" />Restore</Button
			>{:else}<Button
				variant="ghost"
				size="sm"
				class="text-muted-foreground"
				disabled={busy}
				onclick={() => onarchive(true)}><Archive aria-hidden="true" />Archive</Button
			>{/if}
	{/if}
{/snippet}

<DetailScreen
	hasContent={found}
	title={name}
	back={{ href: '/saved', label: 'Saved' }}
	{actions}
	state={{
		remote,
		isEmpty: !found,
		onretry,
		errorTitle: `Couldn't load this ${KIND_LABEL[kind].toLowerCase()}.`,
		empty: {
			title: `${KIND_LABEL[kind]} not found`,
			body: 'It may have been removed. Return to Saved to find another item.'
		}
	}}
>
	<ScreenContent measure="reading">
		<div
			class="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted-foreground"
			data-saved-provenance
		>
			<span>{KIND_LABEL[kind]}</span>
			{#if item?.status === 'done'}<span aria-hidden="true">·</span><span
					>{item.archived ? 'Archived' : 'Done'}</span
				>{/if}
			{#if fromHref}<span aria-hidden="true">·</span><span
					>From <a class="underline-offset-4 hover:underline" href={fromHref}
						>{fromTitle ?? 'the conversation'}</a
					></span
				>{/if}
			{#if date}<span aria-hidden="true">·</span><span>{date}</span>{/if}
		</div>
		{#if error}<p role="alert" class="text-sm text-failed">{error}</p>{/if}
		{#if found}{@render children?.()}{/if}
	</ScreenContent>
</DetailScreen>
