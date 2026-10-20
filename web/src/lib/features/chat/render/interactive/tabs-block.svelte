<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Tabs from '$lib/ui/tabs';

	// `:::tabs` around markdown: the stock tabs, one panel per heading. Switching tabs only changes
	// what is shown.
	let { labels, panel }: { labels: string[]; panel: Snippet<[number]> } = $props();
	let value = $state('0');
</script>

<Tabs.Root bind:value class="my-1 flex min-w-0 flex-col gap-2">
	<div class="-mx-1 overflow-x-auto px-1">
		<Tabs.List>
			{#each labels as label, i (i)}
				<Tabs.Trigger data-rich-control value={String(i)}>{label}</Tabs.Trigger>
			{/each}
		</Tabs.List>
	</div>
	{#each labels as _, i (i)}
		<Tabs.Content value={String(i)} class="flex min-w-0 flex-col gap-2"
			>{@render panel(i)}</Tabs.Content
		>
	{/each}
</Tabs.Root>
