<script lang="ts">
	import { untrack } from 'svelte';
	import Archive from '@lucide/svelte/icons/archive';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import ArchiveRestore from '@lucide/svelte/icons/archive-restore';
	import Pencil from '@lucide/svelte/icons/pencil';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { Button } from '$lib/ui/button';
	import { Input } from '$lib/ui/input';
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
		class="flex flex-col gap-4 px-5 pt-2 pb-5"
		onsubmit={(e) => {
			e.preventDefault();
			if (ready && renaming && !confirmArchive) onrename?.(title.trim());
		}}
	>
		<h2 class="text-lg font-semibold">Conversation settings</h2>
		{#if confirmArchive}
			<p class="text-body">Archive {thread?.title}?</p>
			<p class="text-sm text-muted-foreground">
				Its history stays available. Send a message to continue later.
			</p>
			<Button size="lg" disabled={busy} onclick={onarchive}>
				{#if busy}<LoaderCircle
						class="animate-spin motion-reduce:animate-none"
						aria-hidden="true"
					/>{:else}<Archive />{/if}Archive conversation
			</Button>
			<Button variant="ghost" size="lg" disabled={busy} onclick={() => (confirmArchive = false)}
				>Keep current</Button
			>
		{:else if renaming}
			<div class="flex flex-col gap-2">
				<label for="{uid}-name" class="text-sm font-medium">Conversation name</label>
				<Input
					id="{uid}-name"
					bind:ref={nameInput}
					bind:value={title}
					maxlength={120}
					required
					class="h-12 text-base"
					data-autofocus
				/>
			</div>
			<Button type="submit" size="lg" disabled={!ready}>
				{#if busy}<LoaderCircle
						class="animate-spin motion-reduce:animate-none"
						aria-hidden="true"
					/>Saving…{:else}<Pencil />Save name{/if}
			</Button>
			<Button variant="ghost" size="lg" disabled={busy} onclick={() => (renaming = false)}
				>Back to options</Button
			>
		{:else}
			{#if href}<Button
					variant="ghost"
					size="lg"
					class="justify-start"
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
					size="lg"
					class="justify-start"
					onclick={() => (renaming = true)}><Pencil />Rename conversation</Button
				>{/if}
			{#if thread?.id !== 'main' && thread?.state !== 'archived' && onarchive}
				<Button
					variant="ghost"
					size="lg"
					class="justify-start"
					disabled={busy}
					onclick={() => (confirmArchive = true)}><Archive />Archive conversation</Button
				>
			{:else if thread?.state === 'archived' && onreopen}
				<Button variant="ghost" size="lg" class="justify-start" disabled={busy} onclick={onreopen}
					><ArchiveRestore />Restore conversation</Button
				>
			{/if}
		{/if}
		{#if error}<p role="alert" class="text-sm text-failed">
				Couldn't update the conversation. {error}
			</p>{/if}
		<Button variant="ghost" size="lg" disabled={busy} onclick={onclose}>Close</Button>
	</form>
</RoutedSheet>
