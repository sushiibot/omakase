<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as CodeBlock from '$lib/ui/code-block';
	import { useHighlightedCode } from '$lib/ui/code-block/use-highlighted-code.svelte';

	// A fenced block in agent markdown. Copy is the one control allowed here: it only copies the
	// block's own text, and stays disabled while the block streams so it can't copy half a command.
	let {
		code,
		lang,
		streaming = false,
		caret
	}: {
		code: string;
		lang?: string | null;
		/** The block is still growing: Copy is disabled and `caret` follows its last line. */
		streaming?: boolean;
		caret?: Snippet;
	} = $props();

	const lines = useHighlightedCode(
		() => code,
		() => lang ?? ''
	);
	const last = $derived(lines.current.length - 1);
</script>

<CodeBlock.Root class="text-code">
	<CodeBlock.Actions>
		<CodeBlock.CopyButton value={code} label="Copy code" disabled={streaming} />
	</CodeBlock.Actions>
	<CodeBlock.Content class="pe-12" data-lang={lang}>
		{#each lines.current as line, i (i)}
			{#if i === last && caret}
				<CodeBlock.Line>
					{#if typeof line === 'string'}{line}{:else}{#each line as token, t (t)}<span
								style={token.style}
								class={token.class}>{token.content}</span
							>{/each}{/if}{@render caret()}
				</CodeBlock.Line>
			{:else}
				<CodeBlock.Line code={line} />
			{/if}
		{/each}
	</CodeBlock.Content>
</CodeBlock.Root>
