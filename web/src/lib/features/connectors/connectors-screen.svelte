<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Plus from '@lucide/svelte/icons/plus';
	import Plug from '@lucide/svelte/icons/plug';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleDashed from '@lucide/svelte/icons/circle-dashed';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import { Button } from '$lib/ui/button';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import Screen from '$lib/ui/screen/screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import Section from '$lib/ui/section/section.svelte';
	import ScreenState from '$lib/ui/screen/screen-state.svelte';
	import type { RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import { Skeleton } from '$lib/ui/skeleton';
	import type { McpServerSummary } from './types';

	let {
		remote,
		servers,
		back,
		online = true,
		serverHref = (id) => `/connectors/${id}`,
		addHref = '/connectors/add',
		onretry
	}: {
		remote: RemoteLike;
		servers: McpServerSummary[];
		back?: { href: string; label: string; onclick?: (e: MouseEvent) => void };
		online?: boolean;
		serverHref?: (id: string) => string;
		addHref?: string;
		onretry?: () => void;
	} = $props();

	const uid = $props.id();
	function hostname(url: string) {
		try {
			return new URL(url).hostname;
		} catch {
			return url;
		}
	}

	const sections = $derived([
		{
			label: 'Needs attention',
			items: servers.filter((s) => s.enabled !== false && s.status !== 'connected')
		},
		{
			label: 'Connected',
			items: servers.filter((s) => s.enabled !== false && s.status === 'connected')
		},
		{ label: 'Disconnected', items: servers.filter((s) => s.enabled === false) }
	]);
</script>

{#snippet banner()}
	{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}
{/snippet}

{#snippet skeleton()}
	<div class="flex flex-col gap-3" aria-hidden="true">
		{#each [0, 1, 2] as i (i)}
			<div class="flex items-center gap-3 px-2 py-3">
				<Skeleton class="size-9 rounded-lg" />
				<div class="flex flex-1 flex-col gap-2">
					<Skeleton class="h-4 w-1/3" />
					<Skeleton class="h-3 w-2/3" />
				</div>
			</div>
		{/each}
	</div>
	<p role="status" class="sr-only">Loading connectors…</p>
{/snippet}

{#snippet connectionStatus(s: McpServerSummary)}
	{#if s.enabled === false}
		<span class="inline-flex items-center gap-1.5 text-muted-foreground">
			<Plug class="size-3.5 shrink-0" aria-hidden="true" />Disconnected
		</span>
	{:else if s.status === 'error'}
		<span class="inline-flex items-center gap-1.5 text-failed">
			<CircleAlert class="size-3.5 shrink-0" aria-hidden="true" />Not working
		</span>
	{:else if s.status === 'signed-out'}
		<span class="inline-flex items-center gap-1.5 text-waiting">
			<KeyRound class="size-3.5 shrink-0" aria-hidden="true" />Sign in again
		</span>
	{:else if s.changed}
		<span class="inline-flex items-center gap-1.5 text-muted-foreground">
			<CircleDashed class="size-3.5 shrink-0" aria-hidden="true" />Tools changed
		</span>
	{/if}
{/snippet}

{#snippet row(s: McpServerSummary)}
	<a
		href={serverHref(s.id)}
		class="group grid min-h-16 grid-cols-[1.25rem_minmax(0,1fr)_auto_1rem] items-center gap-x-3 gap-y-1 rounded-md px-2 py-2.5 transition-colors duration-100 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none @2xl:min-h-14 @2xl:grid-cols-[1.25rem_minmax(0,1fr)_14rem_1rem] @2xl:py-2"
	>
		<Plug class="size-4 text-muted-foreground" aria-hidden="true" />
		<span class="flex min-w-0 flex-col gap-0.5">
			<span class="text-sm font-medium [overflow-wrap:anywhere]">{s.name}</span>
			<span class="truncate text-meta text-muted-foreground">{hostname(s.url)}</span>
		</span>
		<span
			class="flex flex-col items-end gap-1 text-meta @2xl:grid @2xl:grid-cols-[4rem_1fr] @2xl:items-center @2xl:gap-x-5"
		>
			<span class="text-muted-foreground tabular-nums"
				>{s.tools} {s.tools === 1 ? 'tool' : 'tools'}</span
			>
			<span class="order-first empty:hidden @2xl:order-last">{@render connectionStatus(s)}</span>
		</span>
		<ChevronRight class="size-3.5 text-muted-foreground" aria-hidden="true" />
	</a>
{/snippet}

<Screen title="Connectors" {back} {banner}>
	<ScreenContent>
		<div class="flex flex-col gap-5">
			<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b pb-3">
				<p class="text-sm text-muted-foreground">Tools available to your agent.</p>
				<Button href={addHref} size="compact" variant="outline" aria-label="Add a server by URL">
					<Plus class="size-4" aria-hidden="true" />Add server
				</Button>
			</div>
			<ScreenState
				{remote}
				isEmpty={servers.length === 0}
				offline={!online}
				errorTitle="Couldn't load connectors."
				{onretry}
				{skeleton}
				empty={{
					title: 'No servers yet',
					body: 'An MCP server gives the agent tools, like your mail or calendar. Add one with its address.'
				}}
			>
				{#each sections as section, i (section.label)}
					{#if section.items.length}
						<Section
							id={`${uid}-section-${i}`}
							title={section.label}
							count={section.items.length}
							tone="list"
						>
							<ul class="flex flex-col">
								{#each section.items as s (s.id)}<li>{@render row(s)}</li>{/each}
							</ul>
						</Section>
					{/if}
				{/each}
			</ScreenState>
		</div>
	</ScreenContent>
</Screen>
