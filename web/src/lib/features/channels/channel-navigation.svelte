<script lang="ts">
	import Hash from '@lucide/svelte/icons/hash';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import ChecklistCheckbox from '$lib/ui/checklist-checkbox.svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import type { Channel, ChannelView } from './types';
	import { channelHref } from './navigation';
	let {
		channels,
		selected,
		view = $bindable('all'),
		query = $bindable(''),
		includeArchived = $bindable(false),
		loading = false,
		error,
		replacing = false,
		onnew,
		onretry,
		onvisit
	}: {
		channels: Channel[];
		selected?: string;
		view?: ChannelView;
		query?: string;
		includeArchived?: boolean;
		loading?: boolean;
		error?: string | null;
		replacing?: boolean;
		onnew: () => void;
		onretry: () => void;
		onvisit: (id: string) => void;
	} = $props();
	let closed = $state<Record<string, boolean>>({});
	let filtersOpen = $state(false);
	const main = $derived(channels.find((c) => c.kind === 'main'));
	const groups = $derived(
		view !== 'all'
			? [
					{
						id: view,
						title: view === 'recent' ? 'Recent' : 'Needs you',
						items: channels.filter((c) => c.kind !== 'main')
					}
				]
			: [
					{
						id: 'channels',
						title: 'Channels',
						items: channels.filter((c) => c.kind === 'channel')
					},
					{ id: 'work', title: 'Task channels', items: channels.filter((c) => c.kind === 'task') }
				]
	);
	function destination(channel: Channel): string {
		const href = channelHref(channel),
			request = channel.attention[0];
		return request
			? `${href}${href.includes('?') ? '&' : '?'}${request.kind === 'ask' ? 'ask' : 'approve'}=${encodeURIComponent(request.id)}`
			: href;
	}
</script>

{#snippet row(channel: Channel)}
	<a
		href={destination(channel)}
		data-sveltekit-replacestate={replacing ? '' : undefined}
		aria-current={selected === channel.id ? 'page' : undefined}
		title={channel.title}
		class="channel"
		class:pending={channel.pending.total > 0}
		onclick={(e) => {
			if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey)
				onvisit(channel.id);
		}}
	>
		{#if channel.kind === 'task'}<ListChecks aria-hidden="true" />{:else}<Hash
				aria-hidden="true"
			/>{/if}
		<span class="truncate"
			>{channel.title}<span class="sr-only">{channel.state === 'archived' ? ', archived' : ''}</span
			></span
		>
		{#if channel.pending.total > 0}<span class="ping"
				>{channel.pending.total}<span class="sr-only"> requests need you</span></span
			>{:else if channel.activity.running}<LoaderCircle
				class="animate-spin motion-reduce:animate-none"
				aria-label="Agent working"
			/>{/if}</a
	>
{/snippet}
<div class="flex min-h-0 flex-1 flex-col" data-channel-list>
	<div class="flex shrink-0 items-center justify-between px-2">
		<a
			href="/chats"
			data-sveltekit-replacestate={replacing ? '' : undefined}
			class="flex min-h-12 flex-1 items-center px-2 text-ui font-semibold">Channels</a
		><button
			class="grid size-12 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent"
			aria-label="Find and filter channels"
			aria-expanded={filtersOpen}
			onclick={() => (filtersOpen = !filtersOpen)}><Search class="size-4" /></button
		><button
			class="grid size-12 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent"
			aria-label="New channel"
			onclick={onnew}><Plus class="size-5" /></button
		>
	</div>
	{#if filtersOpen}<div class="shrink-0 px-2 pb-2">
			<input
				aria-label="Find channels by name or preview"
				placeholder="Find a channel…"
				bind:value={query}
				class="min-h-12 w-full rounded-md border bg-background px-3 text-base"
			/>
			<div class="flex gap-2 pt-2">
				<select
					aria-label="Channel view"
					bind:value={view}
					class="min-h-12 min-w-0 flex-1 rounded-md border bg-background px-2 text-ui"
					><option value="all">All</option><option value="recent">Recent</option><option
						value="needs-you">Needs you</option
					></select
				><label class="flex min-h-12 items-center gap-2 px-2 text-meta"
					><ChecklistCheckbox
						checked={includeArchived}
						label="Include archived channels"
						onchange={() => (includeArchived = !includeArchived)}
					/>Archived</label
				>
			</div>
		</div>{/if}
	{#if query || includeArchived}<p class="px-4 pb-2 text-meta text-muted-foreground">
			{query ? `Matching “${query}”` : ''}{includeArchived ? ' · Includes archived' : ''}
		</p>{/if}
	<div class="channels min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
		{#if main}{@render row(main)}{:else if !query && view !== 'needs-you'}<a
				href="/chat"
				class="channel"
				data-sveltekit-replacestate={replacing ? '' : undefined}
				aria-current={selected === 'main' ? 'page' : undefined}
				onclick={() => onvisit('main')}><Hash aria-hidden="true" /><span>Main</span></a
			>{/if}
		{#each groups as group (group.id)}{#if group.items.length}<button
					class="project"
					aria-expanded={!closed[group.id]}
					aria-controls="channel-group-{group.id}"
					onclick={() => (closed = { ...closed, [group.id]: !closed[group.id] })}
					><ChevronDown class={closed[group.id] ? '-rotate-90' : ''} aria-hidden="true" /><span
						>{group.title}</span
					></button
				>
				<div id="channel-group-{group.id}" hidden={!!closed[group.id]}>
					{#each group.items as channel (channel.id)}{@render row(channel)}{/each}
				</div>{/if}{/each}
		{#if loading && !channels.length}<p
				role="status"
				class="px-2 py-3 text-ui text-muted-foreground"
			>
				Loading channels…
			</p>{/if}
		{#if error}<div role="status" class="px-2 py-3 text-ui text-failed">
				Couldn't refresh channels.<button
					class="mt-2 min-h-12 w-full rounded-md border px-3"
					onclick={onretry}>Try again</button
				>
			</div>{/if}
		{#if !loading && !error && !channels.length}<p class="px-2 py-3 text-ui text-muted-foreground">
				{query
					? 'No matching channels.'
					: view === 'needs-you'
						? 'No channels need you.'
						: 'Start a channel for a topic.'}
			</p>{/if}
	</div>
</div>

<style>
	[data-channel-list] {
		--channel-height: 48px;
		--channel-icon: 20px;
		--channel-text: 1rem;
		--channel-inset: 4px;
	}
	.channel,
	.project {
		display: grid;
		grid-template-columns: var(--channel-icon) minmax(0, 1fr) auto;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: var(--channel-height);
		padding: 8px;
		text-align: left;
		font-size: var(--channel-text);
		line-height: 1.5;
	}
	.channel {
		position: relative;
		isolation: isolate;
		border-radius: 6px;
		color: var(--muted-foreground);
	}
	.channel::before {
		content: '';
		position: absolute;
		inset: var(--channel-inset) 0;
		z-index: -1;
		border-radius: 6px;
		background: var(--channel-background, transparent);
	}
	.channel :global(svg),
	.project :global(svg) {
		width: var(--channel-icon);
		height: var(--channel-icon);
	}
	.channel[aria-current='page'] {
		--channel-background: color-mix(in oklch, var(--sidebar-foreground) 12%, var(--sidebar));
		color: var(--sidebar-foreground);
	}
	.channel.pending {
		font-weight: 600;
	}
	.channel:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
	.project {
		margin-top: 16px;
		font-size: var(--text-ui);
		font-weight: 600;
		color: var(--muted-foreground);
	}
	.project :global(svg) {
		padding: 2px;
	}
	.ping {
		display: grid;
		place-items: center;
		min-width: 20px;
		height: 20px;
		padding-inline: 5px;
		border-radius: 12px;
		background: var(--waiting-soft);
		color: var(--waiting);
		font-size: var(--text-meta);
		font-weight: 600;
	}
	.channels {
		touch-action: pan-y pinch-zoom;
	}
	@media (hover: hover) {
		.channel:not([aria-current='page']):hover {
			--channel-background: color-mix(in oklch, var(--sidebar-foreground) 6%, var(--sidebar));
			color: var(--sidebar-foreground);
		}
	}
	@media (min-width: 1100px) and (hover: hover) and (pointer: fine) {
		[data-channel-list] {
			--channel-height: 36px;
			--channel-icon: 18px;
			--channel-text: var(--text-ui);
			--channel-inset: 2px;
		}
		.channel,
		.project {
			padding-block: 6px;
		}
	}
	@media (any-pointer: coarse) {
		[data-channel-list] {
			--channel-height: 48px;
			--channel-icon: 20px;
			--channel-text: 1rem;
			--channel-inset: 4px;
		}
		.channel,
		.project {
			padding-block: 8px;
		}
	}
</style>
