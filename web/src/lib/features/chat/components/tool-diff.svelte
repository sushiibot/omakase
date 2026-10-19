<script lang="ts">
	import type { ToolDiff } from '$lib/core/realtime/events';
	import * as CodeBlock from '$lib/ui/code-block';
	let { diff }: { diff: ToolDiff } = $props();
	const lines = $derived.by(() => {
		let inHunk = false;
		return diff.patch
			.replace(/\n$/, '')
			.split('\n')
			.map((text) => {
				if (text.startsWith('@@')) {
					inHunk = true;
					return { text, kind: 'hunk' };
				}
				return {
					text,
					kind: !inHunk
						? 'header'
						: text.startsWith('+')
							? 'added'
							: text.startsWith('-')
								? 'removed'
								: 'context'
				};
			});
	});
</script>

<div data-tool-diff class="min-w-0">
	{#if !diff.patch}<p class="text-muted-foreground">Diff is too large to show here.</p>{:else}
		<CodeBlock.Root size="sm" class="text-code">
			<CodeBlock.Header>
				<CodeBlock.Title class="font-normal text-muted-foreground">Changes</CodeBlock.Title>
				<span class="text-review" aria-label="Lines added"
					>+{lines.filter((line) => line.kind === 'added').length}</span
				>
				<span class="text-failed" aria-label="Lines removed"
					>−{lines.filter((line) => line.kind === 'removed').length}</span
				>
			</CodeBlock.Header>
			<CodeBlock.Content role="region" aria-label="File changes" class="max-h-80">
				{#each lines as line, index (index)}<CodeBlock.Line
						variant={line.kind === 'added' || line.kind === 'removed' ? line.kind : 'default'}
						class={line.kind === 'header' || line.kind === 'hunk'
							? 'text-muted-foreground'
							: undefined}
						code={line.kind === 'added' || line.kind === 'removed' ? line.text.slice(1) : line.text}
					/>{/each}
			</CodeBlock.Content>
		</CodeBlock.Root>
		{#if diff.truncated}<p class="mt-2 text-muted-foreground">
				This diff is truncated. Only the recorded portion is shown.
			</p>{/if}
	{/if}
</div>
