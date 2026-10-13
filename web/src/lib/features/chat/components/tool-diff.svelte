<script lang="ts">
	import type { ToolDiff } from '$lib/core/realtime/events';
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
		<div class="mb-2 flex items-center gap-3">
			<span>Changes</span>
			<span class="text-review" aria-label="Lines added"
				>+{lines.filter((line) => line.kind === 'added').length}</span
			>
			<span class="text-failed" aria-label="Lines removed"
				>−{lines.filter((line) => line.kind === 'removed').length}</span
			>
		</div>
		<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to scroll long patches.) -->
		<div
			tabindex="0"
			role="region"
			aria-label="File changes"
			class="max-h-80 overflow-auto rounded-lg border font-mono text-code focus-visible:outline-2 focus-visible:outline-ring"
		>
			<pre class="min-w-fit py-2">{#each lines as line, index (index)}<span
						class="block px-3"
						class:bg-add={line.kind === 'added'}
						class:text-review={line.kind === 'added'}
						class:bg-del={line.kind === 'removed'}
						class:text-failed={line.kind === 'removed'}
						class:text-muted-foreground={line.kind === 'header' || line.kind === 'hunk'}
						>{line.text || ' '}</span
					>{/each}</pre>
		</div>
		{#if diff.truncated}<p class="mt-2 text-muted-foreground">
				This diff is truncated. Only the recorded portion is shown.
			</p>{/if}
	{/if}
</div>
