<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { HomeScreen } from '$lib/features/home';
	import { inboxDisclosure, type Inbox } from './inbox.svelte';

	let { inbox }: { inbox: Inbox } = $props();
	const home = $derived(inbox.home);
	const data = $derived(inbox.data);
	const groups = $derived({ ...home.groups, waiting: [] });
	const total = $derived(Object.values(groups).reduce((count, items) => count + items.length, 0));
</script>

<details
	open={inboxDisclosure.expanded}
	ontoggle={(event) => {
		inboxDisclosure.expanded = event.currentTarget.open;
	}}
	data-inbox="shared"
	aria-label="Inbox"
	class="group/inbox min-w-0"
>
	<summary
		class="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted/60"
	>
		<ChevronDown
			class="size-4 shrink-0 transition-transform group-open/inbox:rotate-180"
			aria-hidden="true"
		/>
		<span>Inbox{total ? ` · ${total}` : ' · No updates'}</span>
	</summary>
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
</details>
