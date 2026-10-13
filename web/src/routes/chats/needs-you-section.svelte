<script lang="ts">
	import { HomeScreen, inboxConversation } from '$lib/features/home';
	import Section from '$lib/ui/section/section.svelte';
	import type { Inbox } from './inbox.svelte';

	let { inbox, threads }: { inbox: Inbox; threads: { id: string; title: string }[] } = $props();
	const home = $derived(inbox.home);
</script>

{#if home.groups.waiting.length}
	<Section title="Needs you">
		<HomeScreen
			embedded
			hideSheet
			compact
			groups={{ waiting: home.groups.waiting, failed: [], running: [], review: [] }}
			remote={{ status: 'ready' }}
			now={inbox.now}
			itemContext={(item) => {
				const id = inboxConversation(item, home.groups);
				return id === 'main'
					? 'Main chat'
					: (threads.find((thread) => thread.id === id)?.title ?? 'Other activity');
			}}
			onopen={(id) => {
				home.clearResult(id);
				inbox.sheet.openWith(id);
			}}
		/>
	</Section>
{/if}
