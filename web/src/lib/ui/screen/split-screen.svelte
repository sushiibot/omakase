<!-- app: screen with an optional sibling review region (ux-guidelines.md#conversations-work-and-activity) -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	let { children, review }: { children: Snippet; review: Snippet } = $props();
</script>

<div class="flex h-full min-h-0 min-w-0 flex-1">
	<div class="flex min-h-0 min-w-0 flex-1 flex-col">{@render children()}</div>
	{@render review()}
</div>
