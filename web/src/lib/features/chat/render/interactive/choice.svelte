<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import { Button } from '$lib/ui/button';
	import type { RichData } from '../rich/blocks';
	import ReplyPanel from './reply-panel.svelte';

	// A question with options. One pick sends at once; with `multiple`, picks toggle and Send sends
	// them joined, exactly as shown.
	let {
		data,
		reply,
		partial = false
	}: {
		data: RichData<'choice'>;
		reply?: (text: string) => void;
		/** Still streaming: shown, never live (no `reply` either). */
		partial?: boolean;
	} = $props();
	let picked = $state<string[]>([]);
	let sent = $state<string | null>(null);
	const disabled = $derived(!reply || sent !== null);

	function send(text: string) {
		if (!reply || sent !== null || !text) return;
		sent = text;
		reply(text);
	}
	function toggle(option: string) {
		picked = picked.includes(option) ? picked.filter((p) => p !== option) : [...picked, option];
	}
</script>

<ReplyPanel live={!!reply} {partial} {sent}>
	<p class="text-sm font-medium">{data.question}</p>
	<div class="flex flex-wrap gap-2" role="group" aria-label={data.question}>
		{#each data.options as option, i (i)}
			{#if data.multiple}
				<Button
					data-rich-control
					variant={picked.includes(option) ? 'secondary' : 'outline'}
					size="sm"
					class="h-auto min-h-7 py-1 whitespace-normal"
					aria-pressed={picked.includes(option)}
					{disabled}
					onclick={() => toggle(option)}
					>{#if picked.includes(option)}<Check aria-hidden="true" />{/if}{option}</Button
				>
			{:else}
				<Button
					data-rich-control
					variant="outline"
					size="sm"
					class="h-auto min-h-7 py-1 whitespace-normal"
					{disabled}
					onclick={() => send(option)}>{option}</Button
				>
			{/if}
		{/each}
	</div>
	{#if data.multiple}
		<Button
			data-rich-control
			variant="secondary"
			size="sm"
			class="self-start"
			disabled={disabled || !picked.length}
			onclick={() => send(data.options.filter((o) => picked.includes(o)).join(', '))}
			>Send {picked.length ? `(${picked.length})` : ''}</Button
		>
	{/if}
</ReplyPanel>
