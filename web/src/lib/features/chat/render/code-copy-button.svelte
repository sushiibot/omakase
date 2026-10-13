<script lang="ts">
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import { Button } from '$lib/ui/button';

	// The one control allowed inside agent markdown: it only copies the block's own text.
	let { text, disabled = false }: { text: string; disabled?: boolean } = $props();

	let copied = $state(false);
	let announcement = $state('');
	let reset: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		clearTimeout(reset);
		try {
			if (!navigator.clipboard) throw new Error('no clipboard');
			await navigator.clipboard.writeText(text);
			copied = true;
			announcement = 'Copied';
		} catch {
			copied = false;
			announcement = "Couldn't copy";
		}
		reset = setTimeout(() => {
			copied = false;
			announcement = '';
		}, 2000);
	}

	$effect(() => () => clearTimeout(reset));
</script>

<Button
	variant="ghost"
	size="icon-sm"
	aria-label="Copy code"
	{disabled}
	onclick={copy}
	class="absolute top-2 right-2 text-muted-foreground"
>
	{#if copied}<Check aria-hidden="true" />{:else}<Copy aria-hidden="true" />{/if}
</Button>
<span class="sr-only" aria-live="polite">{announcement}</span>
