<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/ui/button';
	import { ItemGroup } from '$lib/ui/item';
	import Section from '$lib/ui/section/section.svelte';
	import { Skeleton } from '$lib/ui/skeleton';
	import SavedRow from './components/saved-row.svelte';
	import { conversationSaved } from './model';
	import { savedStore } from './saved.svelte';

	// The side panel's Saved tab: what the agent made in this conversation, active first, then done.
	let { conversationId }: { conversationId: string } = $props();
	const store = savedStore();
	const groups = $derived(conversationSaved(store.items, conversationId));
	let now = $state(Date.now());
	onMount(() => {
		void store.all.ensure();
		const stop = store.all.watch();
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => {
			stop();
			clearInterval(timer);
		};
	});
</script>

<div
	class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain p-4"
	data-saved-panel
>
	{#if store.all.status === 'loading' && !store.all.data}
		<div role="status" class="space-y-2">
			<span class="sr-only">Loading saved items…</span><Skeleton class="h-10 w-full" /><Skeleton
				class="h-10 w-full"
			/>
		</div>
	{:else if store.all.status === 'error' && !store.all.data}
		<div role="alert" class="flex flex-col items-start gap-2">
			<p class="text-sm text-muted-foreground">Couldn't load saved items.</p>
			<Button variant="outline" onclick={() => void store.all.refetch()}>Try again</Button>
		</div>
	{:else if !groups.active.length && !groups.done.length}
		<p class="text-sm text-muted-foreground">
			Documents, checklists, recipes and timers the agent makes in this conversation appear here.
		</p>
	{:else}
		{#each [{ label: 'Active', items: groups.active }, { label: 'Done', items: groups.done }] as group (group.label)}
			{#if group.items.length}
				<Section title={group.label} tone="list" count={group.items.length}>
					<ItemGroup class="gap-0">
						{#each group.items as item (item.id)}<div role="listitem">
								<SavedRow {item} {now} />
							</div>{/each}
					</ItemGroup>
				</Section>
			{/if}
		{/each}
	{/if}
	<div><Button href="/saved" variant="ghost" size="sm">All saved items</Button></div>
</div>
