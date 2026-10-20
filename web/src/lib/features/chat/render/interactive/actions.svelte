<script lang="ts">
	import { Button } from '$lib/ui/button';
	import type { RichData } from '../rich/blocks';
	import ReplyPanel from './reply-panel.svelte';
	import type { LiveBinding } from '../rich/live';

	// Suggested next replies. A tap sends the label exactly as shown, as the owner's message.
	let {
		data,
		reply,
		partial = false,
		live
	}: {
		data: RichData<'actions'>;
		reply?: (text: string) => void;
		/** Still streaming: shown, never live (no `reply` either). */
		partial?: boolean;
		/** The stored block: what was sent from it shows on every device. */
		live?: LiveBinding;
	} = $props();
	let localSent = $state<string | null>(null);
	// Answered on any device: the stored block says so, and this one stops sending too.
	const sent = $derived(live?.block.state.sent ?? localSent);
</script>

<ReplyPanel title={data.prompt} live={!!reply} {partial} {sent}>
	<div class="flex flex-wrap gap-2">
		{#each data.items as item, i (i)}
			<Button
				data-rich-control
				variant="outline"
				size="sm"
				class="h-auto min-h-7 py-1 whitespace-normal"
				disabled={!reply || sent !== null}
				onclick={() => {
					if (!reply || sent !== null) return;
					localSent = item;
					reply(item);
					live?.apply([{ op: 'sent', text: item }]);
				}}>{item}</Button
			>
		{/each}
	</div>
</ReplyPanel>
