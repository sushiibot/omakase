<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { ChatsScreen } from '$lib/features/threads';
	import { HomeScreen } from '$lib/features/home';
	import { busyGroups } from '$lib/features/home/fixtures';
	import * as Collapsible from '$lib/ui/collapsible';
	import DisclosureTrigger from '$lib/ui/collapsible/disclosure-trigger.svelte';

	let props: ComponentProps<typeof ChatsScreen> = $props();
</script>

{#snippet inbox()}
	{@const groups = { ...busyGroups(props.now), waiting: [] }}
	{@const total = Object.values(groups).reduce((count, items) => count + items.length, 0)}
	<Collapsible.Root role="group" aria-label="Inbox" class="min-w-0">
		<DisclosureTrigger class="px-3"><span>Inbox · {total}</span></DisclosureTrigger>
		<Collapsible.Content hiddenUntilFound>
			<HomeScreen embedded hideSheet {groups} remote={{ status: 'ready' }} now={props.now} />
		</Collapsible.Content>
	</Collapsible.Root>
{/snippet}

{#snippet attention()}
	<section aria-label="Needs you" class="flex flex-col gap-2">
		<h2 class="px-1 text-base font-semibold">Needs you</h2>
		<HomeScreen
			embedded
			hideSheet
			compact
			groups={{ waiting: busyGroups(props.now).waiting, failed: [], running: [], review: [] }}
			remote={{ status: 'ready' }}
			now={props.now}
			itemContext={() => 'Main chat'}
		/>
	</section>
{/snippet}

<ChatsScreen {...props} {inbox} {attention} />
