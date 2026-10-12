<script lang="ts">
	import { untrack } from 'svelte';
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
	let synced: string | null | undefined;
	let clearing = false;
	// A newly loaded or saved name fills the field, unless you have typed something else meanwhile.
	$effect(() => {
		const saved = remote.data?.name;
		untrack(() => {
			if (saved === synced) return;
			const typed = draft.trim();
			if (typed === (synced ?? '') || typed === (saved ?? '') || (clearing && saved === null))
				draft = saved ?? '';
			clearing = false;
			synced = saved;
		});
	});

	const current = $derived(remote.data?.name ?? '');
	const dirty = $derived(draft.trim() !== current);
	const saving = $derived(save === 'saving');
	const failed = $derived(save === 'failed' && !!error);
</script>

{#snippet loading()}
	<p class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
		<LoaderCircle class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
		Loading your name…
	</p>
{/snippet}

<div class="rounded-xl border bg-card px-4 py-4">
	<ScreenState {remote} errorTitle="Couldn't load your name." {onretry} skeleton={loading}>
		<form
			class="flex flex-col gap-3"
			onsubmit={(e) => {
				e.preventDefault();
				if (dirty && !saving) onsave?.(draft.trim() || null);
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
					class="h-12 text-base"
				/>
				<p id="{uid}-help" class="text-sm text-muted-foreground">
					The agent calls you this from its next conversation. Leave it empty to be called “the
					user”.
				</p>
			</div>
			<div class="flex flex-col gap-2 sm:flex-row">
				<Button type="submit" size="lg" class="sm:flex-1" disabled={!dirty || saving}>
					{#if saving}
						<LoaderCircle class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
						Saving…
					{:else}
						Save name
					{/if}
				</Button>
				{#if current}
					<Button
						variant="outline"
						size="lg"
						class="sm:flex-1"
						disabled={saving}
						onclick={() => {
							// The field empties once the clear is saved; a failed clear keeps it.
							clearing = true;
							onsave?.(null);
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
			{:else if save === 'saved' && !dirty}
				<p role="status" class="text-sm text-muted-foreground">
					{current ? 'Saved.' : 'Cleared. The agent calls you “the user”.'}
				</p>
			{/if}
		</form>
	</ScreenState>
</div>
