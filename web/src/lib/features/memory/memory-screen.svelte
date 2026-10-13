<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import FileText from '@lucide/svelte/icons/file-text';
	import { Button } from '$lib/ui/button';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import { ago } from '$lib/ui/format/time';
	import SearchField from '$lib/ui/input/search-field.svelte';
	import * as Item from '$lib/ui/item';
	import { PageIntro } from '$lib/ui/page';
	import ScreenState from '$lib/ui/screen/screen-state.svelte';
	import type { RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import TabbedScreen from '$lib/ui/screen/tabbed-screen.svelte';
	import Section from '$lib/ui/section/section.svelte';
	import { Skeleton } from '$lib/ui/skeleton';
	import WriteRow from './components/write-row.svelte';
	import type { MemoryFileSummary, MemoryOverview, MemoryWriteRecord } from './types';

	type Entry = { kind: 'write'; w: MemoryWriteRecord } | { kind: 'file'; f: MemoryFileSummary };

	let {
		remote,
		data,
		now,
		back,
		online = true,
		recent = 3,
		writeHref = (id) => `/memory/writes/${id}`,
		fileHref = (id) => `/memory/files/${id}`,
		writesHref = '/memory/writes',
		onretry
	}: {
		remote: RemoteLike;
		data?: MemoryOverview;
		now: number;
		back?: { href: string; label: string; onclick?: (e: MouseEvent) => void };
		online?: boolean;
		/** How many of the newest changes show above the files. */
		recent?: number;
		writeHref?: (id: string) => string;
		fileHref?: (id: string) => string;
		writesHref?: string;
		onretry?: () => void;
	} = $props();

	let category = $state('long-term');
	let search = $state('');
	const query = $derived(search.trim().toLowerCase());
	const tabs = $derived([
		{ value: 'long-term', label: 'Long-term' },
		{ value: 'daily', label: 'Daily notes' },
		...(data?.writes.length ? [{ value: 'changes', label: 'Changes' }] : [])
	]);
	$effect(() => {
		if (!tabs.some((tab) => tab.value === category)) category = tabs[0].value;
	});
	const daily = (f: MemoryFileSummary) => /^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(f.path);
	function itemsFor(value: string): Entry[] {
		if (value === 'changes')
			return (data?.writes ?? [])
				.filter((w) =>
					`${w.path} ${w.summary} ${w.thread?.title ?? ''} ${w.run?.title ?? ''}`
						.toLowerCase()
						.includes(query)
				)
				.slice(0, recent)
				.map((w) => ({ kind: 'write', w }));
		return (data?.files ?? [])
			.filter(
				(f) =>
					(value === 'daily' ? daily(f) : !daily(f)) &&
					`${f.path} ${f.about}`.toLowerCase().includes(query)
			)
			.sort((a, b) =>
				value === 'daily' ? b.path.localeCompare(a.path) : a.path.localeCompare(b.path)
			)
			.map((f) => ({ kind: 'file', f }));
	}
	const heading = (value: string) =>
		value === 'changes' ? 'Recent changes' : value === 'daily' ? 'Daily notes' : 'Long-term files';
</script>

{#snippet banner()}
	{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}
{/snippet}

{#snippet skeleton()}
	<div class="flex flex-col gap-3" aria-hidden="true">
		{#each [0, 1, 2, 3] as i (i)}
			<div class="flex flex-col gap-2 px-3 py-2.5">
				<Skeleton class="h-4 w-3/4" />
				<Skeleton class="h-3 w-1/2" />
			</div>
		{/each}
	</div>
	<p role="status" class="sr-only">Loading memory…</p>
{/snippet}

{#snippet row(item: Entry)}
	{#if item.kind === 'write'}
		<WriteRow write={item.w} {now} href={writeHref(item.w.id)} />
	{:else}
		<Item.Root size="sm">
			{#snippet child({ props })}
				<a href={fileHref(item.f.id)} {...props}>
					<Item.Media variant="icon">
						<FileText class="text-muted-foreground" aria-hidden="true" />
					</Item.Media>
					<Item.Content class="min-w-0">
						<Item.Title class="line-clamp-none font-mono [overflow-wrap:anywhere]"
							>{item.f.path}</Item.Title
						>
						<Item.Description>{item.f.about}</Item.Description>
						<p class="text-xs text-muted-foreground tabular-nums">
							{item.f.lines} lines · changed {ago(item.f.updatedAt, now)}
						</p>
					</Item.Content>
					<Item.Actions>
						<ChevronRight class="size-4 text-muted-foreground" aria-hidden="true" />
					</Item.Actions>
				</a>
			{/snippet}
		</Item.Root>
	{/if}
{/snippet}

{#snippet lead()}
	<div class="flex flex-col gap-3">
		<SearchField label="Search memory" bind:value={search} />
		{#if data?.truncated}<p role="status" class="text-sm text-muted-foreground">
				Some files could not be shown in full because the memory browsing limit was reached.
			</p>{/if}
	</div>
{/snippet}

<TabbedScreen
	title="Memory"
	{back}
	{banner}
	{tabs}
	bind:value={category}
	label="Memory sections"
	{lead}
>
	{#snippet children(value)}
		{@const items = itemsFor(value)}
		<div class="flex flex-col gap-4 md:gap-6">
			<PageIntro
				description={value === 'long-term'
					? 'Saved facts and preferences the agent keeps across conversations. Open a file to read its current contents.'
					: value === 'daily'
						? 'The agent’s memory notes for each day. Work recaps and run records live in History.'
						: 'Recent recorded changes to saved memory.'}
			/>
			<ScreenState
				remote={data && (remote.status === 'loading' || remote.status === 'error')
					? { status: 'ready' }
					: remote}
				offline={!online}
				errorTitle="Couldn't load memory."
				{onretry}
				{skeleton}
				isEmpty={!items.length}
				empty={{
					title: query
						? 'No matching memory'
						: value === 'daily'
							? 'No daily notes yet'
							: value === 'changes'
								? 'No recorded changes yet'
								: 'Nothing remembered yet',
					action: query ? { label: 'Clear search', onclick: () => (search = '') } : undefined,
					body: query
						? value === 'changes'
							? 'No changes match your search. Try another word or clear the search.'
							: 'No files match your search. Try another word or clear the search.'
						: value === 'daily'
							? 'Daily notes appear here when the agent saves them.'
							: 'Saved facts and preferences appear here when the agent remembers them.'
				}}
			>
				<Section title={heading(value)} tone="list">
					<Item.Group>
						{#each items as item (item.kind === 'write' ? `w:${item.w.id}` : `f:${item.f.id}`)}
							<div role="listitem">{@render row(item)}</div>
						{/each}
					</Item.Group>
				</Section>
				{#if value === 'changes' && data && data.writes.length > recent}
					<Button variant="outline" href={writesHref} class="self-start"
						>All {data.writes.length} changes</Button
					>
				{/if}
			</ScreenState>
			{#if data && remote.status === 'error'}
				<div role="alert" class="flex flex-col items-start gap-2">
					<p class="text-sm text-failed">Couldn't refresh memory. {remote.error}</p>
					{#if onretry}<Button variant="outline" onclick={onretry}>Retry refresh</Button>{/if}
				</div>
			{/if}
		</div>
	{/snippet}
</TabbedScreen>
