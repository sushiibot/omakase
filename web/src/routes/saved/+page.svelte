<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Remote } from '$lib/core/remote.svelte';
	import { channelsStore } from '$lib/features/channels';
	import {
		conversationTitle,
		filterSaved,
		isChip,
		savedStore,
		SavedLibraryScreen,
		type SavedChip
	} from '$lib/features/saved';

	const store = savedStore();
	const channels = channelsStore();
	// The filters live in the URL, so Back and a reload keep them.
	const chip = $derived<SavedChip>(
		isChip(page.url.searchParams.get('kind'))
			? (page.url.searchParams.get('kind') as SavedChip)
			: 'all'
	);
	const status = $derived(page.url.searchParams.get('status') === 'done' ? 'done' : 'active');
	function setParam(key: string, value: string, fallback: string) {
		const url = new URL(page.url);
		if (value === fallback) url.searchParams.delete(key);
		else url.searchParams.set(key, value);
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true, state: page.state });
	}

	// A search also reads document content, which only the server holds.
	let query = $state('');
	let committed = $state('');
	const search = new Remote(() => store.api.list({ status: 'all', query: committed }));
	$effect(() => {
		const value = query.trim();
		const timer = setTimeout(() => {
			committed = value;
			if (value) void search.refetch();
		}, 200);
		return () => clearTimeout(timer);
	});

	let now = $state(Date.now());
	onMount(() => {
		untrack(() => void store.all.ensure());
		const stops = [store.all.watch(), channels.watch()];
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => {
			stops.forEach((stop) => stop());
			clearInterval(timer);
		};
	});
	const source = $derived(committed ? search : store.all);
	const items = $derived(
		filterSaved(committed ? (search.data?.items ?? []) : store.items, { chip, status })
	);
	const titleOf = (id: string) => conversationTitle(id, channels.list.data?.channels ?? []);
</script>

<svelte:head><title>Saved · sushii</title></svelte:head>
<SavedLibraryScreen
	remote={source}
	{items}
	bind:chip={() => chip, (next) => setParam('kind', next, 'all')}
	bind:status={() => status, (next) => setParam('status', next, 'active')}
	bind:query
	{titleOf}
	{now}
	truncated={!!source.data?.truncated}
	onretry={() => void source.refetch()}
/>
