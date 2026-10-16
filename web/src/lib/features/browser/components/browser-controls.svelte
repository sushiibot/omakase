<script lang="ts">
	import { Button } from '$lib/ui/button';
	import { Input } from '$lib/ui/input';
	import type { BrowserInput, BrowserPreviewStatus } from '../preview-types';
	let {
		status,
		busy,
		unavailable,
		error,
		control
	}: {
		status: BrowserPreviewStatus;
		busy: boolean;
		unavailable: boolean;
		error: string;
		control: (action: 'takeover' | 'resume' | 'input', input?: BrowserInput) => Promise<boolean>;
	} = $props();
	let text = $state('');
	const owner = $derived(status.control === 'owner');
	$effect(() => {
		if (!owner) text = '';
	});
	async function send(event: SubmitEvent) {
		event.preventDefault();
		if (text && !busy && !unavailable && (await control('input', { kind: 'text', text })))
			text = '';
	}
</script>

<div class="max-h-1/2 shrink-0 space-y-2 overflow-y-auto border-t px-3 py-2">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<p class="text-sm">
			{owner
				? 'Select a field on the page, then enter text below.'
				: 'Take control to sign in. The agent will wait.'}
		</p>
		<Button
			variant={owner ? 'default' : 'outline'}
			disabled={busy}
			onclick={() => control(owner ? 'resume' : 'takeover')}
		>
			{busy ? 'Working…' : owner ? 'Return to agent' : 'Take control'}
		</Button>
	</div>
	{#if owner}
		<form class="flex items-end gap-2" onsubmit={send}>
			<label class="min-w-0 flex-1 space-y-1 text-sm">
				<span>Text or password</span>
				<Input
					type="password"
					bind:value={text}
					maxlength={4096}
					autocomplete="off"
					disabled={busy || unavailable}
				/>
			</label>
			<Button type="submit" disabled={busy || unavailable || !text}>Send text</Button>
		</form>
		<div class="flex flex-wrap gap-2" aria-label="Browser keyboard controls">
			{#each [['Tab', 'Next field'], ['Shift+Tab', 'Previous field'], ['Enter', 'Enter'], ['Backspace', 'Backspace'], ['Control+a', 'Select all'], ['Escape', 'Escape']] as [key, label]}
				<Button
					variant="outline"
					disabled={busy || unavailable}
					onclick={() => control('input', { kind: 'key', key })}>{label}</Button
				>
			{/each}
			<Button
				variant="outline"
				disabled={busy || unavailable}
				onclick={() => control('input', { kind: 'scroll', direction: 'up' })}>Scroll up</Button
			>
			<Button
				variant="outline"
				disabled={busy || unavailable}
				onclick={() => control('input', { kind: 'scroll', direction: 'down' })}>Scroll down</Button
			>
		</div>
		<p class="text-meta text-muted-foreground">
			{status.profile === 'temporary'
				? 'Temporary session. Logins will not be saved.'
				: 'Logins are saved in this browser for future tasks.'}
		</p>
	{/if}
	{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
</div>
