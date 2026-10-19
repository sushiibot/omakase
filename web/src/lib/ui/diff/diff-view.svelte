<!-- app: line diff for memory and skill changes over the stock CodeBlock (ux-guidelines.md#long-content-on-narrow-screens) -->
<script lang="ts" module>
	export interface DiffLine {
		kind: 'add' | 'del' | 'ctx';
		text: string;
	}
</script>

<script lang="ts">
	import * as CodeBlock from '$lib/ui/code-block';

	let {
		lines,
		file,
		class: className
	}: { lines: DiffLine[]; file?: string; class?: string } = $props();
	const added = $derived(lines.filter((l) => l.kind === 'add').length);
	const removed = $derived(lines.filter((l) => l.kind === 'del').length);
	const variant = { add: 'added', del: 'removed', ctx: 'default' } as const;
</script>

<!-- A gutter mark and screen-reader words carry each change, so colour is never the only signal.
     Memory and skill text is prose, so lines wrap instead of scrolling. -->
<CodeBlock.Root class={['text-code', className]}>
	{#if file}
		<CodeBlock.Header>
			<CodeBlock.Title class="font-mono font-normal [overflow-wrap:anywhere] whitespace-normal"
				>{file}</CodeBlock.Title
			>
			<CodeBlock.Actions class="tabular-nums">
				<span class="text-review">+{added}</span>
				<span class="text-failed">−{removed}</span>
				<span class="sr-only">: {added} lines added, {removed} removed</span>
			</CodeBlock.Actions>
		</CodeBlock.Header>
	{/if}
	<CodeBlock.Content wrap>
		{#each lines as line, i (i)}
			<CodeBlock.Line variant={variant[line.kind]}
				>{#if line.kind !== 'ctx'}<span class="sr-only"
						>{line.kind === 'add' ? 'Added: ' : 'Removed: '}</span
					>{/if}{line.text || '\n'}</CodeBlock.Line
			>
		{/each}
	</CodeBlock.Content>
</CodeBlock.Root>
