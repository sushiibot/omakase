<script lang="ts">
	import { Button } from '$lib/ui/button';
	import type { RichData } from '../rich/blocks';
	import ReplyPanel from './reply-panel.svelte';

	// Suggested next replies. A tap sends the label exactly as shown, as the owner's message.
	let { data, reply }: { data: RichData<'actions'>; reply?: (text: string) => void } = $props();
	let sent = $state<string | null>(null);
</script>

<ReplyPanel title={data.prompt} live={!!reply} {sent}>
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
					sent = item;
					reply(item);
				}}>{item}</Button
			>
		{/each}
	</div>
</ReplyPanel>
