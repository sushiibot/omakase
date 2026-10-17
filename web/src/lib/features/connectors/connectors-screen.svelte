<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Plus from '@lucide/svelte/icons/plus';
	import Plug from '@lucide/svelte/icons/plug';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleDashed from '@lucide/svelte/icons/circle-dashed';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import { Badge } from '$lib/ui/badge';
	import { Button } from '$lib/ui/button';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import * as Item from '$lib/ui/item';
	import { PageIntro } from '$lib/ui/page';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
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
		mailHref = '/connectors/mail',
		onretry
	}: {
		remote: RemoteLike;
		servers: McpServerSummary[];
		back?: { href: string; label: string; onclick?: (e: MouseEvent) => void };
		online?: boolean;
		serverHref?: (id: string) => string;
		addHref?: string;
		mailHref?: string;
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
			<div class="flex items-center gap-3 px-3 py-3">
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
		<Badge variant="outline" class="text-muted-foreground">
			<Plug data-icon="inline-start" aria-hidden="true" />Disconnected
		</Badge>
	{:else if s.status === 'error'}
		<Badge variant="destructive">
			<CircleAlert data-icon="inline-start" aria-hidden="true" />Not working
		</Badge>
	{:else if s.status === 'signed-out'}
		<Badge variant="outline" class="text-waiting">
			<KeyRound data-icon="inline-start" aria-hidden="true" />Sign in again
		</Badge>
	{:else if s.changed}
		<Badge variant="secondary">
			<CircleDashed data-icon="inline-start" aria-hidden="true" />Tools changed
		</Badge>
	{/if}
{/snippet}

{#snippet row(s: McpServerSummary)}
	<div role="listitem">
		<Item.Root size="sm">
			{#snippet child({ props })}
				<a href={serverHref(s.id)} {...props}>
					<Item.Media variant="icon">
						<Plug class="text-muted-foreground" aria-hidden="true" />
					</Item.Media>
					<Item.Content class="min-w-0">
						<Item.Title class="[overflow-wrap:anywhere]">{s.name}</Item.Title>
						<Item.Description class="truncate">{hostname(s.url)}</Item.Description>
					</Item.Content>
					<Item.Actions>
						<span class="flex flex-col items-end gap-1 @lg:flex-row @lg:items-center @lg:gap-3">
							{@render connectionStatus(s)}
							<span class="text-xs text-muted-foreground tabular-nums"
								>{s.tools} {s.tools === 1 ? 'tool' : 'tools'}</span
							>
						</span>
						<ChevronRight class="size-4 text-muted-foreground" aria-hidden="true" />
					</Item.Actions>
				</a>
			{/snippet}
		</Item.Root>
	</div>
{/snippet}

<DetailScreen title="Connectors" {back} {banner}>
	<ScreenContent>
		<PageIntro description="Tools available to your agent.">
			{#snippet actions()}
				<Button href={mailHref} variant="outline">Accounts &amp; rules</Button>
				<Button href={addHref} variant="outline" aria-label="Add a server by URL">
					<Plus aria-hidden="true" />Add server
				</Button>
			{/snippet}
		</PageIntro>
		<ScreenState
			{remote}
			isEmpty={servers.length === 0}
			offline={!online}
			errorTitle="Couldn't load connectors."
			{onretry}
			{skeleton}
			empty={{
				title: 'No servers yet',
				body: 'Connect mail through Accounts & rules, or add an MCP server for other tools.'
			}}
		>
			<div class="flex flex-col gap-6">
				{#each sections as section, i (section.label)}
					{#if section.items.length}
						<Section
							id={`${uid}-section-${i}`}
							title={section.label}
							count={section.items.length}
							tone="list"
						>
							<Item.Group>
								{#each section.items as s (s.id)}{@render row(s)}{/each}
							</Item.Group>
						</Section>
					{/if}
				{/each}
			</div>
		</ScreenState>
	</ScreenContent>
</DetailScreen>
