<script lang="ts">
	import { Spinner } from '$lib/ui/spinner';
	import { untrack } from 'svelte';
	import Archive from '@lucide/svelte/icons/archive';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import ArchiveRestore from '@lucide/svelte/icons/archive-restore';
	import Pencil from '@lucide/svelte/icons/pencil';
	import { Button } from '$lib/ui/button';
	import { Input } from '$lib/ui/input';
	import * as Field from '$lib/ui/field';
	import * as Sheet from '$lib/ui/sheet';
	import RoutedSheet from '$lib/ui/sheet/routed-sheet.svelte';
	import type { ThreadSummary } from '../types';

	let {
		open,
		thread,
		busy = false,
		error = null,
		onrename,
		onarchive,
		onreopen,
		href,
		onopen,
		initialRename = false,
		onclose
	}: {
		open: boolean;
		thread?: ThreadSummary;
		busy?: boolean;
		error?: string | null;
		onrename?: (title: string) => void;
		onarchive?: () => void;
		onreopen?: () => void;
		href?: string;
		onopen?: (href: string) => void;
		initialRename?: boolean;
		onclose?: () => void;
	} = $props();
	const uid = $props.id();
	let title = $state('');
	let confirmArchive = $state(false);
	let renaming = $state(false);
	let nameInput = $state<HTMLInputElement | null>(null);
	$effect(() => {
		if (open && renaming && nameInput) nameInput.focus({ preventScroll: true });
	});
	let wasOpen = false;
	let shownId: string | undefined;
	$effect(() => {
		const nextOpen = open;
		const nextId = thread?.id;
		untrack(() => {
			if (nextOpen && (!wasOpen || nextId !== shownId)) {
				title = thread?.title ?? '';
				confirmArchive = false;
				renaming = initialRename;
			}
			wasOpen = nextOpen;
			shownId = nextId;
		});
	});
	const ready = $derived(!!title.trim() && title.trim() !== thread?.title && !busy);
</script>

<RoutedSheet {open} label="Conversation settings" {onclose}>
	<form
		class="flex flex-col"
		onsubmit={(e) => {
			e.preventDefault();
			if (ready && renaming && !confirmArchive) onrename?.(title.trim());
		}}
	>
		<Sheet.Header>
			<Sheet.Title>Conversation settings</Sheet.Title>
			{#if confirmArchive}
				<p class="pt-2 text-sm">Archive {thread?.title}?</p>
				<Sheet.Description>
					Its history stays available. Send a message to continue later.
				</Sheet.Description>
			{/if}
		</Sheet.Header>
		{#if renaming && !confirmArchive}
			<Field.Field class="px-4">
				<Field.Label for="{uid}-name">Conversation name</Field.Label>
				<Input
					id="{uid}-name"
					bind:ref={nameInput}
					bind:value={title}
					maxlength={120}
					required
					data-autofocus
				/>
			</Field.Field>
		{:else if !confirmArchive}
			<div class="flex flex-col px-2">
				{#if href}<Button
						variant="ghost"
						class="justify-start any-pointer-coarse:h-11 any-pointer-coarse:after:hidden"
						{href}
						onclick={(event) => {
							if (
								!onopen ||
								event.button !== 0 ||
								event.metaKey ||
								event.ctrlKey ||
								event.shiftKey ||
								event.altKey
							)
								return;
							event.preventDefault();
							onopen(href);
						}}><MessageSquare />Open conversation</Button
					>{/if}
				{#if onrename}<Button
						variant="ghost"
						class="justify-start any-pointer-coarse:h-11 any-pointer-coarse:after:hidden"
						onclick={() => (renaming = true)}><Pencil />Rename conversation</Button
					>{/if}
				{#if thread?.id !== 'main' && thread?.state !== 'archived' && onarchive}
					<Button
						variant="ghost"
						class="justify-start any-pointer-coarse:h-11 any-pointer-coarse:after:hidden"
						disabled={busy}
						onclick={() => (confirmArchive = true)}><Archive />Archive conversation</Button
					>
				{:else if thread?.state === 'archived' && onreopen}
					<Button
						variant="ghost"
						class="justify-start any-pointer-coarse:h-11 any-pointer-coarse:after:hidden"
						disabled={busy}
						onclick={onreopen}><ArchiveRestore />Restore conversation</Button
					>
				{/if}
			</div>
		{/if}
		{#if error}<p role="alert" class="px-4 pt-4 text-sm text-failed">
				Couldn't update the conversation. {error}
			</p>{/if}
		<Sheet.Footer class={confirmArchive || renaming ? 'any-pointer-coarse:gap-4' : undefined}>
			{#if confirmArchive}
				<Button size="lg" disabled={busy} onclick={onarchive}>
					{#if busy}<Spinner decorative />{:else}<Archive />{/if}Archive conversation
				</Button>
				<Button variant="ghost" size="lg" disabled={busy} onclick={() => (confirmArchive = false)}
					>Keep current</Button
				>
			{:else if renaming}
				<Button type="submit" size="lg" disabled={!ready}>
					{#if busy}<Spinner decorative />Saving…{:else}<Pencil />Save name{/if}
				</Button>
				<Button variant="ghost" size="lg" disabled={busy} onclick={() => (renaming = false)}
					>Back to options</Button
				>
			{/if}
			<Button variant="ghost" size="lg" disabled={busy} onclick={onclose}>Close</Button>
		</Sheet.Footer>
	</form>
</RoutedSheet>
