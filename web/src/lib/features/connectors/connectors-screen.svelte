<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Plus from '@lucide/svelte/icons/plus';
	import { Button } from '$lib/ui/button';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import Screen from '$lib/ui/screen/screen.svelte';
	import ManagementContent from '$lib/ui/screen/management-content.svelte';
	import ScreenState from '$lib/ui/screen/screen-state.svelte';
	import type { RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import { Skeleton } from '$lib/ui/skeleton';
	import StatePill from '$lib/ui/status/state-pill.svelte';
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

{#snippet row(s: McpServerSummary)}
	<a
		href={serverHref(s.id)}
		class="flex min-h-16 items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-14 md:py-2"
	>
		<span
			class="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-sm font-medium"
			aria-hidden="true">{s.name[0]}</span
		>
		<span class="flex min-w-0 flex-1 flex-col gap-1">
			<span class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
				<span class="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{s.name}</span>
				{#if s.enabled === false}<StatePill of="quiet" label="Disconnected" />
				{:else if s.status === 'error'}<StatePill of="failed" label="Not working" />
				{:else if s.status === 'signed-out'}<StatePill of="waiting" label="Sign in again" />
				{:else if s.changed}<StatePill of="quiet" label="Tools changed" />{/if}
			</span>
			<span class="flex min-w-0 items-center justify-between gap-3 text-meta text-muted-foreground">
				<span class="truncate">{hostname(s.url)}</span>
				<span class="shrink-0 tabular-nums">{s.tools} {s.tools === 1 ? 'tool' : 'tools'}</span>
			</span>
		</span>
		<ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
	</a>
{/snippet}

<Screen title="Connectors" {back} {banner}>
	<ManagementContent>
		<div class="flex flex-col gap-6">
			<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
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
						<section aria-labelledby="{uid}-section-{i}" class="flex flex-col gap-2">
							<h2 id="{uid}-section-{i}" class="flex items-center gap-2 text-sm font-medium">
								{section.label}<span
									aria-hidden="true"
									class="font-normal text-muted-foreground tabular-nums"
									>{section.items.length}</span
								>
							</h2>
							<div class="divide-y border-y">
								{#each section.items as s (s.id)}{@render row(s)}{/each}
							</div>
						</section>
					{/if}
				{/each}
			</ScreenState>
		</div>
	</ManagementContent>
</Screen>
