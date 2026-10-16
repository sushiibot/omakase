<script lang="ts">
	import { Button } from '$lib/ui/button';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import type { RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import { Markdown } from '$lib/features/chat';
	import type { Artifact } from './types';
	let {
		remote,
		document,
		onretry
	}: { remote: RemoteLike; document?: Artifact | null; onretry: () => void } = $props();
	const conversation = $derived(
		document?.conversationId === 'main'
			? '/chat'
			: document?.conversationId.startsWith('task-t-')
				? `/tasks/${encodeURIComponent(document.conversationId.slice(5))}?view=conversation`
				: `/chats/${encodeURIComponent(document?.conversationId ?? '')}`
	);
</script>

<DetailScreen
	title={document?.title ?? 'Document'}
	back={{ href: '/artifacts', label: 'Artifacts' }}
	state={{
		remote,
		isEmpty: document === null,
		onretry,
		errorTitle: "Couldn't load this document.",
		empty: { title: 'Document not found', body: 'Return to Artifacts to find another document.' }
	}}
>
	{#if document}<ScreenContent measure="reading">
			<div
				class="flex flex-wrap items-center justify-between gap-3 text-meta text-muted-foreground"
			>
				<span
					>Version {document.version} · Updated {new Date(
						document.updatedAt
					).toLocaleString()}</span
				><Button variant="link" href={conversation}>Open source chat</Button>
			</div>
			<article aria-label={document.title} class="text-body">
				<Markdown text={document.content} />
			</article>
		</ScreenContent>{/if}
</DetailScreen>
