<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	// `:::details` around markdown. Native <details>, not the stock Collapsible: agent text may not
	// render buttons (scripts/check-no-raw-html.ts), and a summary opens and closes without script.
	let { summary, children }: { summary: string; children: Snippet } = $props();
</script>

<details class="group my-1 rounded-lg border">
	<summary
		class="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 font-medium [&::-webkit-details-marker]:hidden"
	>
		<ChevronRight
			class="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
			aria-hidden="true"
		/>
		{summary}
	</summary>
	<div class="flex flex-col gap-2 border-t px-3 py-2">{@render children()}</div>
</details>
