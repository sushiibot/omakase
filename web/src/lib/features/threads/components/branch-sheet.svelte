<script lang="ts">
	import { Spinner } from '$lib/ui/spinner';
	import Split from '@lucide/svelte/icons/split';
	import { Button } from '$lib/ui/button';
	import { Input } from '$lib/ui/input';
	import * as Field from '$lib/ui/field';
	import * as Sheet from '$lib/ui/sheet';
	import RoutedSheet from '$lib/ui/sheet/routed-sheet.svelte';

	let {
		open,
		quote,
		title = $bindable(''),
		busy = false,
		error = null,
		onstart,
		onclose
	}: {
		open: boolean;
		/** The reply it starts from, as plain text; none for a thread from scratch. */
		quote?: string;
		title?: string;
		busy?: boolean;
		error?: string | null;
		onstart?: (title: string) => void;
		onclose?: () => void;
	} = $props();
	const uid = $props.id();
	const ready = $derived(title.trim().length > 0 && !busy);
</script>

<RoutedSheet {open} label="Start a conversation" {onclose}>
	<form
		class="flex flex-col"
		onsubmit={(e) => {
			e.preventDefault();
			if (ready) onstart?.(title.trim());
		}}
	>
		<Sheet.Header>
			<Sheet.Title>Start a conversation</Sheet.Title>
			<Sheet.Description>
				An ongoing conversation for a topic or workstream, with separate context and shared memory.
				{#if quote}It starts with the selected reply from Main.{:else}Give it a name, then send your
					first message.{/if}
			</Sheet.Description>
		</Sheet.Header>
		<div class="flex flex-col gap-4 px-4">
			{#if quote}
				<p
					class="line-clamp-3 border-l pl-3 text-sm [overflow-wrap:anywhere] text-muted-foreground"
				>
					{quote}
				</p>
			{/if}
			<Field.Field>
				<Field.Label for="{uid}-title">Conversation name</Field.Label>
				<Input id="{uid}-title" bind:value={title} maxlength={120} data-autofocus />
			</Field.Field>
			{#if error}
				<p role="alert" class="text-sm text-failed">Couldn't start the conversation. {error}</p>
			{/if}
		</div>
		<Sheet.Footer class="any-pointer-coarse:gap-4">
			<Button size="lg" type="submit" disabled={!ready}>
				{#if busy}<Spinner
						role="presentation"
						aria-hidden="true"
						class="motion-reduce:animate-none"
					/>Starting the conversation…{:else}<Split />Start conversation{/if}
			</Button>
			<Button size="lg" variant="ghost" onclick={onclose}>Cancel</Button>
		</Sheet.Footer>
	</form>
</RoutedSheet>
