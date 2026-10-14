<script lang="ts">
	import type { Snippet } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import { Button } from '$lib/ui/button';
	import * as Collapsible from '$lib/ui/collapsible';
	import DisclosureTrigger from '$lib/ui/collapsible/disclosure-trigger.svelte';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import UpdateToast from '$lib/ui/pwa/update-toast.svelte';
	import ListScreen, { type ListSection } from '$lib/ui/screen/list-screen.svelte';
	import type { RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import { Skeleton } from '$lib/ui/skeleton';
	import ThreadRow from './components/thread-row.svelte';
	import type { ChatsData, ThreadSummary } from './types';

	let {
		inbox,
		attention,
		notice,
		remote,
		data,
		now,
		query = $bindable(''),
		online = true,
		updateReady = false,
		mainHref = '/chat',
		threadHref = (id) => `/chats/${id}`,
		onretry,
		onnew,
		onoptions,
		onreload
	}: {
		inbox?: Snippet;
		attention?: Snippet;
		/** A transient line in the toast, shown in place of the update notice. */
		notice?: Snippet;
		remote: RemoteLike;
		data?: ChatsData;
		now: number;
		query?: string;
		online?: boolean;
		updateReady?: boolean;
		mainHref?: string;
		threadHref?: (id: string) => string;
		onretry?: () => void;
		/** Starts a thread from scratch. */
		onnew?: () => void;
		onoptions?: (thread: ThreadSummary) => void;
		onreload?: () => void;
	} = $props();

	const threads = $derived(
		[...(data?.threads ?? [])].sort(
			(a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity)
		)
	);
	const q = $derived(query.trim().toLowerCase());
	const active = $derived(threads.filter((t) => t.state !== 'archived'));
	const archived = $derived(threads.filter((t) => t.state === 'archived'));

	const sections = $derived.by((): ListSection<ThreadSummary>[] => {
		if (q) {
			const hits = threads.filter(
				(t) => t.title.toLowerCase().includes(q) || t.preview.toLowerCase().includes(q)
			);
			return [{ label: `${hits.length} matching`, items: hits }];
		}
		return [{ label: 'Channels', count: true, items: active }];
	});
</script>

{#snippet banner()}
	{#if !online}<ConnectionBanner state={{ kind: 'app-offline', savedThreads: true }} />{/if}
{/snippet}
{#snippet toast()}<UpdateToast onreload={() => onreload?.()} />{/snippet}

{#snippet actions()}
	{#if onnew}
		<Button variant="ghost" aria-label="New conversation" onclick={onnew}
			><Plus /><span class="hidden @sm:inline">New conversation</span></Button
		>
	{/if}
{/snippet}

{#snippet skeleton()}
	<div class="flex flex-col gap-3" aria-hidden="true">
		{#each [0, 1, 2, 3] as i (i)}
			<div class="flex items-center gap-3 px-2 py-2.5">
				<Skeleton class="size-10 rounded-lg" />
				<div class="flex flex-1 flex-col gap-2">
					<Skeleton class="h-4 w-1/2" />
					<Skeleton class="h-3 w-4/5" />
				</div>
			</div>
		{/each}
	</div>
	<p role="status" class="sr-only">Loading conversations…</p>
{/snippet}

{#snippet lead()}
	{@render attention?.()}
	<section aria-label="Main chat" class="rounded-xl border bg-card px-1 py-1">
		<ThreadRow
			main={data?.main ?? {
				state: 'idle',
				preview: 'Your general-purpose conversation',
				lastActivity: new Date(now).toISOString()
			}}
			onoptions={onoptions
				? () =>
						onoptions?.({
							id: 'main',
							title: data?.main.title ?? 'Main',
							state: data?.main.state ?? 'idle',
							preview: data?.main.preview ?? '',
							lastActivity: data?.main.lastActivity ?? new Date(now).toISOString(),
							writes: 0
						})
				: undefined}
			showActivity={!!data?.main}
			href={mainHref}
			{now}
		/>
	</section>
{/snippet}

{#snippet row(t: ThreadSummary)}
	<ThreadRow
		thread={t}
		href={threadHref(t.id)}
		{now}
		onoptions={onoptions ? () => onoptions?.(t) : undefined}
	/>
{/snippet}

{#snippet after()}
	{#if !q && archived.length}
		<section aria-label="Archived conversations">
			<Collapsible.Root>
				<DisclosureTrigger class="px-3">
					<span>Archived · <span class="tabular-nums">{archived.length}</span></span>
				</DisclosureTrigger>
				<Collapsible.Content hiddenUntilFound>
					<ul>
						{#each archived as t (t.id)}<li>{@render row(t)}</li>{/each}
					</ul>
				</Collapsible.Content>
			</Collapsible.Root>
		</section>
	{/if}
	{#if data && !q}
		<p class="px-1 text-meta text-muted-foreground">
			Inactive conversations move below into Archived after {data.archiveAfterDays} days. Send a message
			to resume any conversation. History stays available.
		</p>
	{/if}
{/snippet}

{#snippet tail()}
	{@render inbox?.()}
{/snippet}

<ListScreen
	{tail}
	title="Channels"
	{banner}
	{actions}
	toast={notice ?? (updateReady ? toast : undefined)}
	bind:search={query}
	searchLabel="Search channels"
	state={{
		remote,
		offline: !online,
		errorTitle: "Couldn't load your conversations.",
		onretry,
		skeleton,
		empty: q
			? {
					title: 'No conversations match',
					body: `No conversation mentions “${query.trim()}”.`
				}
			: {
					title: 'No conversations yet',
					body: 'Use Main chat above, or start a channel for a specific topic.',
					...(onnew ? { action: { label: 'Start a conversation', onclick: onnew } } : {})
				}
	}}
	{sections}
	isEmpty={q ? sections[0].items.length === 0 : threads.length === 0}
	key={(t) => t.id}
	{lead}
	{row}
	{after}
/>
