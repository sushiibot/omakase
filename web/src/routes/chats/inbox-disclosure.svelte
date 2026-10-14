<script lang="ts">
	import * as Collapsible from '$lib/ui/collapsible';
	import DisclosureTrigger from '$lib/ui/collapsible/disclosure-trigger.svelte';
	import { HomeScreen } from '$lib/features/home';
	import { inboxDisclosure, type Inbox } from './inbox.svelte';

	let { inbox }: { inbox: Inbox } = $props();
	const home = $derived(inbox.home);
	const data = $derived(inbox.data);
	const groups = $derived({ ...home.groups, waiting: [] });
	const total = $derived(Object.values(groups).reduce((count, items) => count + items.length, 0));
</script>

<Collapsible.Root
	bind:open={inboxDisclosure.expanded}
	data-inbox="shared"
	role="group"
	aria-label="Inbox"
	class="min-w-0"
>
	<DisclosureTrigger class="px-3">
		<span>Inbox{total ? ` · ${total}` : ' · No updates'}</span>
	</DisclosureTrigger>
	<Collapsible.Content hiddenUntilFound>
		<div class="px-2 pt-2 pb-3">
			<HomeScreen
				embedded
				hideSheet
				{groups}
				remote={inbox.remote}
				now={inbox.now}
				partError={inbox.greeted && data.status === 'error' ? data.error : null}
				partLoading={inbox.greeted && data.status === 'loading' && data.slow}
				workspace={data.data?.workspace.state ?? 'online'}
				onopen={(id) => {
					home.clearResult(id);
					inbox.sheet.openWith(id);
				}}
				onretry={() => void data.refetch()}
				ondone={inbox.done}
			/>
		</div>
	</Collapsible.Content>
</Collapsible.Root>
