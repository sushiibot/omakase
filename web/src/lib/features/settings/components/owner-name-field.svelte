<script lang="ts">
	import { tick, untrack } from 'svelte';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { Button } from '$lib/ui/button';
	import { Input } from '$lib/ui/input';
	import ScreenState, { type RemoteLike } from '$lib/ui/screen/screen-state.svelte';
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
		<LoaderCircle class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
		Loading your name…
	</p>
{/snippet}

<div class="py-4">
	<ScreenState {remote} errorTitle="Couldn't load your name." {onretry} skeleton={loading}>
		{#if !editing}
			<div class="flex items-center justify-between gap-4">
				<div class="min-w-0">
					<p class="text-sm font-medium">Your name</p>
					<p
						class="mt-1 text-sm [overflow-wrap:anywhere] text-muted-foreground"
						data-testid="owner-name"
					>
						{current || 'Not set'}
					</p>
				</div>
				<Button
					id="{uid}-edit"
					variant="outline"
					size="compact"
					aria-label="Edit your name"
					onclick={openEditor}>Edit</Button
				>
			</div>
		{:else}
			<form
				class="flex max-w-lg flex-col gap-3"
				onsubmit={(e) => {
					e.preventDefault();
					if (dirty && !saving) submit(draft.trim() || null);
				}}
			>
				<div class="flex flex-col gap-2">
					<label for="{uid}-name" class="text-sm font-medium">Your name</label>
					<Input
						id="{uid}-name"
						bind:value={draft}
						maxlength={OWNER_NAME_MAX}
						autocomplete="nickname"
						autocapitalize="words"
						spellcheck={false}
						aria-invalid={failed || undefined}
						aria-describedby="{uid}-help{failed ? ` ${uid}-error` : ''}"
						class="h-12 text-base md:text-base"
					/>
					<p id="{uid}-help" class="text-sm text-muted-foreground">
						The agent calls you this from its next conversation. Leave it empty to be called “the
						user”.
					</p>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<Button type="submit" size="compact" disabled={!dirty || saving}>
						{#if saving}
							<LoaderCircle class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
							Saving…
						{:else}
							Save name
						{/if}
					</Button>
					<Button
						variant="outline"
						size="compact"
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
							size="compact"
							disabled={saving}
							onclick={() => {
								// The field empties once the clear is saved; a failed clear keeps it.
								submit(null);
							}}
						>
							Clear name
						</Button>
					{/if}
				</div>
				{#if failed}
					<p id="{uid}-error" role="alert" class="text-sm text-failed">
						Couldn't save your name. {error}
					</p>
				{/if}
			</form>
		{/if}
		{#if save === 'saved' && !dirty}
			<p role="status" class="text-sm text-muted-foreground">
				{current ? 'Saved.' : 'Cleared. The agent calls you “the user”.'}
			</p>
		{/if}
	</ScreenState>
</div>
