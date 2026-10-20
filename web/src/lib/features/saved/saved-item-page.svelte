<script lang="ts">
	import { untrack } from 'svelte';
	import { conversationHref } from '$lib/core/nav/conversation';
	import { Remote } from '$lib/core/remote.svelte';
	import type { RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import { channelsStore } from '$lib/features/channels';
	import { liveBlocksStore, LiveBlockView, Markdown, parseLiveBlockId } from '$lib/features/chat';
	import SavedItemScreen from './saved-item-screen.svelte';
	import { conversationTitle } from './model';
	import { savedStore } from './saved.svelte';
	import type { SavedItem, SavedKind } from './types';

	// A saved item's page (/saved/<kind>/<id>, and /artifacts/<id> for documents). A document reads
	// from the artifact store; a checklist, recipe or timer is the live block itself, editable here
	// and in sync with chat. Opening it counts as use, so it stays active.
	let { kind, id }: { kind: SavedKind; id: string } = $props();
	const saved = savedStore();
	const live = liveBlocksStore();
	const channels = channelsStore();

	const record = $derived.by(() => {
		const target = id;
		return new Remote(() => saved.api.get(target), { refetchOnFocus: true });
	});
	const document = $derived.by(() => {
		const target = id;
		return kind === 'document'
			? new Remote(() => saved.api.document(target), { refetchOnFocus: true })
			: null;
	});
	$effect(() => {
		const current = record;
		untrack(() => void current.ensure());
		return current.watch();
	});
	$effect(() => {
		const current = document;
		if (!current) return;
		untrack(() => void current.ensure());
		return current.watch();
	});
	$effect(() => {
		untrack(() => {
			void saved.all.ensure();
			void channels.list.ensure();
		});
		return channels.watch();
	});
	$effect(() => {
		if (kind === 'document') return;
		const parsed = parseLiveBlockId(id);
		if (parsed) live.watch([parsed.messageKey]);
	});
	$effect(() => {
		const target = id;
		untrack(() => void saved.act(target, 'opened'));
	});

	const block = $derived(kind === 'document' ? undefined : live.records.get(id));
	const item = $derived<SavedItem | null | undefined>(saved.find(id) ?? record.data);
	const conversationId = $derived(
		item?.conversationId ?? document?.data?.conversationId ?? block?.conversationId
	);
	const sourceMessageId = $derived(item?.sourceMessageId ?? (block ? block.messageKey : undefined));
	const found = $derived(kind === 'document' ? !!document?.data : !!block);
	const remote = $derived.by((): RemoteLike => {
		if (document) return document;
		if (block) return { status: 'ready' };
		if (record.status === 'error') return record;
		if (record.status === 'ready' && record.data === null) return { status: 'ready' };
		return { status: 'loading', slow: record.slow };
	});
	const created = $derived(item?.createdAt ?? document?.data?.createdAt ?? block?.createdAt);

	async function act(action: 'pin' | 'unpin' | 'archive' | 'restore') {
		const result = await saved.act(id, action);
		if (result) record.data = result;
	}
</script>

<SavedItemScreen
	{kind}
	title={document?.data?.title ?? block?.title ?? item?.title}
	{item}
	{remote}
	{found}
	fromTitle={conversationId
		? conversationTitle(conversationId, channels.list.data?.channels ?? [])
		: undefined}
	fromHref={conversationId
		? conversationHref(conversationId, sourceMessageId ? { message: sourceMessageId } : undefined)
		: undefined}
	date={created
		? new Date(created).toLocaleDateString(undefined, {
				month: 'short',
				day: 'numeric',
				year: 'numeric'
			})
		: undefined}
	busy={saved.busy.has(id)}
	error={saved.error}
	onpin={(pinned) => void act(pinned ? 'pin' : 'unpin')}
	onarchive={(archived) => void act(archived ? 'archive' : 'restore')}
	onretry={() => {
		void record.refetch();
		void document?.refetch();
	}}
>
	{#if document?.data}
		<p class="text-meta text-muted-foreground">
			Version {document.data.version} · Updated {new Date(document.data.updatedAt).toLocaleString()}
		</p>
		<article aria-label={document.data.title} class="text-body">
			<Markdown text={document.data.content} document />
		</article>
	{:else if block}
		<LiveBlockView {block} {live} />
	{/if}
</SavedItemScreen>
