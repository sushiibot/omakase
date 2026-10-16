<script lang="ts">
	import * as Item from '$lib/ui/item';
	import ListScreen from '$lib/ui/screen/list-screen.svelte';
	import type { RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import FileText from '@lucide/svelte/icons/file-text';
	import type { ArtifactList, ArtifactSummary } from './types';
	let {
		remote,
		data,
		query = $bindable(''),
		onretry
	}: { remote: RemoteLike; data?: ArtifactList; query?: string; onretry: () => void } = $props();
</script>

{#snippet row(document: ArtifactSummary)}
	<Item.Root size="sm">
		{#snippet child({ props })}
			<a href="/artifacts/{document.id}" {...props}>
				<Item.Media><FileText class="size-5 text-muted-foreground" aria-hidden="true" /></Item.Media
				>
				<Item.Content class="min-w-0">
					<Item.Title>{document.title}</Item.Title>
					<Item.Description
						>Version {document.version} · {new Date(
							document.updatedAt
						).toLocaleDateString()}</Item.Description
					>
				</Item.Content>
			</a>
		{/snippet}
	</Item.Root>
{/snippet}
{#snippet after()}{#if data?.truncated}<p class="text-meta text-muted-foreground">
			Showing the first 2,000 saved documents.
		</p>{/if}{/snippet}
<ListScreen
	title="Artifacts"
	bind:search={query}
	searchLabel="Search titles and document content"
	sections={[{ items: data?.artifacts ?? [] }]}
	key={(doc) => doc.id}
	{row}
	{after}
	state={{
		remote,
		onretry,
		errorTitle: "Couldn't load artifacts.",
		empty: {
			title: query ? 'No matching documents' : 'No artifacts yet',
			body: query
				? 'Try another search.'
				: 'Ask the agent to create a report or save a document. It will appear here.'
		}
	}}
/>
