<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { Button } from '$lib/ui/button';
	import * as Field from '$lib/ui/field';
	import { Input } from '$lib/ui/input';
	import ScreenState, { type RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import { Spinner } from '$lib/ui/spinner';
	import { OWNER_NAME_MAX } from '../types';

	let {
		remote,
		save = 'idle',
		error = null,
		onsave,
		onretry
	}: {
		remote: RemoteLike & { data?: { name: string | null } };
		save?: 'idle' | 'saving' | 'saved' | 'failed';
		error?: string | null;
		onsave?: (name: string | null) => void;
		onretry?: () => void;
	} = $props();
	const uid = $props.id();

	let draft = $state('');
	let editing = $state(false);
	let pending = $state(false);
	let showError = $state(true);
	async function closeEditor() {
		editing = false;
		await tick();
		document.getElementById(`${uid}-edit`)?.focus();
	}
	async function openEditor() {
		showError = false;
		editing = true;
		await tick();
		document.getElementById(`${uid}-name`)?.focus();
	}
	function submit(name: string | null) {
		showError = true;
		pending = true;
		submittedDraft = draft;
		onsave?.(name);
	}
	let synced: string | null | undefined;
	let submittedDraft: string | undefined;
	// A newly loaded or saved name fills the field, unless you have typed something else meanwhile.
	$effect(() => {
		const saved = remote.data?.name;
		untrack(() => {
			if (saved === synced) return;
			const typed = draft.trim();
			const unchanged =
				submittedDraft !== undefined
					? draft === submittedDraft
					: typed === (synced ?? '') || typed === (saved ?? '');
			if (unchanged) draft = saved ?? '';
			submittedDraft = undefined;
			synced = saved;
		});
	});

	const current = $derived(remote.data?.name ?? '');
	const dirty = $derived(draft.trim() !== current);
	const saving = $derived(save === 'saving');
	const failed = $derived(showError && save === 'failed' && !!error);
	$effect(() => {
		if (!pending || save === 'saving' || save === 'idle') return;
		if (save === 'saved') {
			pending = false;
			if (!dirty) void closeEditor();
		} else if (save === 'failed') {
			pending = false;
			submittedDraft = undefined;
		}
	});
</script>

{#snippet loading()}
	<p class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
		<Spinner role="presentation" aria-hidden="true" class="motion-reduce:animate-none" />
		Loading your name…
	</p>
{/snippet}

<ScreenState {remote} errorTitle="Couldn't load your name." {onretry} skeleton={loading}>
	{#if !editing}
		<Field.Field orientation="horizontal">
			<Field.Content>
				<Field.Title>Your name</Field.Title>
				<Field.Description class="[overflow-wrap:anywhere]" data-testid="owner-name">
					{current || 'Not set'}
				</Field.Description>
			</Field.Content>
			<Button id="{uid}-edit" variant="outline" aria-label="Edit your name" onclick={openEditor}
				>Edit</Button
			>
		</Field.Field>
	{:else}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				if (dirty && !saving) submit(draft.trim() || null);
			}}
		>
			<Field.Group>
				<Field.Field data-invalid={failed || undefined}>
					<Field.Label for="{uid}-name">Your name</Field.Label>
					<Input
						id="{uid}-name"
						bind:value={draft}
						maxlength={OWNER_NAME_MAX}
						autocomplete="nickname"
						autocapitalize="words"
						spellcheck={false}
						aria-invalid={failed || undefined}
						aria-describedby="{uid}-help{failed ? ` ${uid}-error` : ''}"
					/>
					<Field.Description id="{uid}-help">
						The agent calls you this from its next conversation. Leave it empty to be called “the
						user”.
					</Field.Description>
					{#if failed}
						<p id="{uid}-error" role="alert" class="text-sm text-failed">
							Couldn't save your name. {error}
						</p>
					{/if}
				</Field.Field>
				<Field.Field orientation="horizontal" class="flex-wrap">
					<Button type="submit" disabled={!dirty || saving}>
						{#if saving}
							<Spinner role="presentation" aria-hidden="true" class="motion-reduce:animate-none" />
							Saving…
						{:else}
							Save name
						{/if}
					</Button>
					<Button
						variant="outline"
						disabled={saving}
						onclick={() => {
							draft = current;
							submittedDraft = undefined;
							pending = false;
							void closeEditor();
						}}>Cancel</Button
					>
					{#if current}
						<Button
							variant="ghost"
							disabled={saving}
							onclick={() => {
								// The field empties once the clear is saved; a failed clear keeps it.
								submit(null);
							}}
						>
							Clear name
						</Button>
					{/if}
				</Field.Field>
			</Field.Group>
		</form>
	{/if}
	{#if save === 'saved' && !dirty}
		<p role="status" class="text-sm text-muted-foreground">
			{current ? 'Saved.' : 'Cleared. The agent calls you “the user”.'}
		</p>
	{/if}
</ScreenState>
