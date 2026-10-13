<!-- modeled on shadcn-svelte sidebar-07 NavMain (collapsible groups) and NavProjects (row actions) -->
<script lang="ts">
	import { untrack } from 'svelte';
	import Hash from '@lucide/svelte/icons/hash';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import * as Sidebar from '$lib/ui/sidebar';
	import * as Collapsible from '$lib/ui/collapsible';
	import * as ToggleGroup from '$lib/ui/toggle-group';
	import { Button } from '$lib/ui/button';
	import { Spinner } from '$lib/ui/spinner';
	import { cn } from '$lib/utils';
	import type { Channel, ChannelView } from './types';
	import { channelHref } from './navigation';
	let {
		channels,
		selected,
		view = $bindable('all'),
		query = $bindable(''),
		closed = $bindable({ archived: true }),
		filtersOpen = $bindable(false),
		loading = false,
		error,
		replacing = false,
		onnew,
		onretry,
		onvisit,
		onoptions
	}: {
		channels: Channel[];
		selected?: string;
		view?: ChannelView;
		query?: string;
		/** Collapsed groups and the filter panel, kept by the caller so a remount keeps them. */
		closed?: Record<string, boolean>;
		filtersOpen?: boolean;
		loading?: boolean;
		error?: string | null;
		replacing?: boolean;
		onnew: () => void;
		onretry: () => void;
		onvisit: (id: string) => void;
		onoptions?: (channel: Channel) => void;
	} = $props();
	const active = $derived(channels.filter((c) => c.state !== 'archived'));
	const archived = $derived(channels.filter((c) => c.state === 'archived'));
	// Starting or clearing a search toggles Archived; a remount keeps whatever the owner chose.
	let wasSearching = untrack(() => !!query.trim());
	$effect(() => {
		const searching = !!query.trim();
		if (searching === wasSearching) return;
		wasSearching = searching;
		untrack(() => (closed = { ...closed, archived: !searching }));
	});
	const main = $derived(channels.find((c) => c.kind === 'main'));
	const groups = $derived(
		view !== 'all'
			? [
					{
						id: view,
						title: view === 'recent' ? 'Recent' : 'Needs you',
						items: active.filter((c) => c.kind !== 'main')
					}
				]
			: [
					{
						id: 'channels',
						title: 'Channels',
						items: active.filter((c) => c.kind === 'channel')
					},
					{ id: 'work', title: 'Task channels', items: active.filter((c) => c.kind === 'task') }
				]
	);
	const views: { value: ChannelView; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'recent', label: 'Recent' },
		{ value: 'needs-you', label: 'Needs you' }
	];
	// Touch rows grow from h-8 to 44px, so the badge and action re-centre on them.
	const coarseTop = 'any-pointer-coarse:peer-data-[size=default]/menu-button:top-3';
	// The stock badge takes the row's accent colour on hover and selection; a request keeps its tone.
	const waitingBadge =
		'bg-waiting-soft text-waiting peer-hover/menu-button:text-waiting peer-data-active/menu-button:text-waiting';
	const labelClass =
		'w-full text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground any-pointer-coarse:h-11';
	function destination(channel: Channel): string {
		const href = channelHref(channel),
			request = channel.attention[0];
		return request
			? `${href}${href.includes('?') ? '&' : '?'}${request.kind === 'ask' ? 'ask' : 'approve'}=${encodeURIComponent(request.id)}`
			: href;
	}
	function toggle(id: string, open: boolean) {
		closed = { ...closed, [id]: !open };
	}
</script>

{#snippet row(channel: Channel)}
	{@const pending = channel.pending.total}
	<Sidebar.MenuItem>
		<Sidebar.MenuButton
			isActive={selected === channel.id}
			class={cn(
				'any-pointer-coarse:h-11',
				pending > 0 && 'font-semibold',
				pending > 0 && !onoptions && 'pr-8',
				onoptions &&
					(pending > 0
						? 'group-has-data-[sidebar=menu-action]/menu-item:pr-14 any-pointer-coarse:group-has-data-[sidebar=menu-action]/menu-item:pr-18'
						: 'any-pointer-coarse:group-has-data-[sidebar=menu-action]/menu-item:pr-12')
			)}
		>
			{#snippet child({ props })}
				<a
					{...props}
					href={destination(channel)}
					data-sveltekit-replacestate={replacing ? '' : undefined}
					aria-current={selected === channel.id ? 'page' : undefined}
					title={channel.title}
					onclick={(e) => {
						if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey)
							onvisit(channel.id);
					}}
				>
					{#if channel.kind === 'task'}<ListChecks aria-hidden="true" />{:else}<Hash
							aria-hidden="true"
						/>{/if}
					<span class="min-w-0 flex-1 truncate"
						>{channel.title}<span class="sr-only"
							>{channel.state === 'archived' ? ', archived' : ''}{pending > 0
								? ` ${pending} requests need you`
								: ''}</span
						></span
					>
					{#if !pending && channel.activity.running}<Spinner
							role="img"
							aria-label="Agent working"
							class="text-muted-foreground"
						/>{/if}
				</a>
			{/snippet}
		</Sidebar.MenuButton>
		{#if pending > 0}<Sidebar.MenuBadge
				aria-hidden="true"
				class={cn(waitingBadge, coarseTop, onoptions && 'right-7 any-pointer-coarse:right-12')}
				>{pending}</Sidebar.MenuBadge
			>{/if}
		{#if onoptions}<Sidebar.MenuAction
				showOnHover
				aria-label="Options for {channel.title}"
				aria-haspopup="dialog"
				class="any-pointer-coarse:right-2 any-pointer-coarse:w-6 any-pointer-coarse:opacity-100 any-pointer-coarse:peer-data-[size=default]/menu-button:top-2.5 any-pointer-coarse:after:-inset-x-3.5 any-pointer-coarse:after:-inset-y-2.5 any-pointer-coarse:after:block"
				onclick={() => onoptions?.(channel)}><Ellipsis /></Sidebar.MenuAction
			>{/if}
	</Sidebar.MenuItem>
{/snippet}
{#snippet groupLabel(title: string, count?: number)}
	<Sidebar.GroupLabel class={labelClass}>
		{#snippet child({ props })}
			<Collapsible.Trigger {...props}>
				<span>{title}</span>
				{#if count !== undefined}<span class="ms-2 tabular-nums">{count}</span>{/if}
				<ChevronRight
					aria-hidden="true"
					class="ms-auto transition-transform group-data-[state=open]/collapsible:rotate-90"
				/>
			</Collapsible.Trigger>
		{/snippet}
	</Sidebar.GroupLabel>
{/snippet}
<div class="flex min-h-0 flex-1 flex-col" data-channel-list>
	<Sidebar.Group class="shrink-0 pb-0">
		<div class="flex items-center gap-2 any-pointer-coarse:gap-4">
			<Sidebar.GroupLabel class={cn(labelClass, 'min-w-0 flex-1')}>
				{#snippet child({ props })}
					<a {...props} href="/chats" data-sveltekit-replacestate={replacing ? '' : undefined}
						>Channels</a
					>
				{/snippet}
			</Sidebar.GroupLabel>
			<Button
				variant="ghost"
				size="icon-sm"
				class="text-muted-foreground"
				aria-label="Find and filter channels"
				aria-expanded={filtersOpen}
				onclick={() => (filtersOpen = !filtersOpen)}><Search /></Button
			>
			<Button
				variant="ghost"
				size="icon-sm"
				class="text-muted-foreground"
				aria-label="New channel"
				onclick={onnew}><Plus /></Button
			>
		</div>
		{#if filtersOpen}<div class="flex flex-col gap-2 pt-2">
				<Sidebar.Input
					aria-label="Find channels by name or preview"
					placeholder="Find a channel…"
					bind:value={query}
				/>
				<ToggleGroup.Root
					type="single"
					variant="outline"
					size="sm"
					aria-label="Channel view"
					class="w-full"
					bind:value={() => view, (next) => next && (view = next as ChannelView)}
				>
					{#each views as item (item.value)}<ToggleGroup.Item
							value={item.value}
							class="flex-1 any-pointer-coarse:h-11">{item.label}</ToggleGroup.Item
						>{/each}
				</ToggleGroup.Root>
			</div>{/if}
		{#if query}<p class="px-2 pt-2 text-xs text-muted-foreground">Matching “{query}”</p>{/if}
	</Sidebar.Group>
	<Sidebar.Content class="overscroll-contain">
		<Sidebar.Group>
			<Sidebar.Menu>
				{#if main}{@render row(main)}{:else if !query && view !== 'needs-you'}<Sidebar.MenuItem>
						<Sidebar.MenuButton isActive={selected === 'main'} class="any-pointer-coarse:h-11">
							{#snippet child({ props })}
								<a
									{...props}
									href="/chat"
									data-sveltekit-replacestate={replacing ? '' : undefined}
									aria-current={selected === 'main' ? 'page' : undefined}
									onclick={() => onvisit('main')}><Hash aria-hidden="true" /><span>Main</span></a
								>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>{/if}
			</Sidebar.Menu>
		</Sidebar.Group>
		{#each groups as group (group.id)}{#if group.items.length}<Collapsible.Root
					open={!closed[group.id]}
					onOpenChange={(open) => toggle(group.id, open)}
					class="group/collapsible"
				>
					<Sidebar.Group>
						{@render groupLabel(group.title)}
						<Collapsible.Content>
							<Sidebar.Menu>
								{#each group.items as channel (channel.id)}{@render row(channel)}{/each}
							</Sidebar.Menu>
						</Collapsible.Content>
					</Sidebar.Group>
				</Collapsible.Root>{/if}{/each}
		{#if archived.length}<Collapsible.Root
				open={!closed.archived}
				onOpenChange={(open) => toggle('archived', open)}
				class="group/collapsible"
			>
				<Sidebar.Group>
					{@render groupLabel('Archived', archived.length)}
					<Collapsible.Content>
						<Sidebar.Menu>
							{#each archived as channel (channel.id)}{@render row(channel)}{/each}
						</Sidebar.Menu>
					</Collapsible.Content>
				</Sidebar.Group>
			</Collapsible.Root>{/if}
		{#if loading && !channels.length}<p
				role="status"
				class="px-4 py-3 text-sm text-muted-foreground"
			>
				Loading channels…
			</p>{/if}
		{#if error}<div role="status" class="flex flex-col gap-2 px-4 py-3 text-sm text-failed">
				Couldn't refresh channels.<Button variant="outline" onclick={onretry}>Try again</Button>
			</div>{/if}
		{#if !loading && !error && !channels.length}<p class="px-4 py-3 text-sm text-muted-foreground">
				{query
					? 'No matching channels.'
					: view === 'needs-you'
						? 'No channels need you.'
						: 'Start a channel for a topic.'}
			</p>{/if}
	</Sidebar.Content>
</div>
