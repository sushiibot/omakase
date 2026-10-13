<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Check from '@lucide/svelte/icons/check';
	import Plug from '@lucide/svelte/icons/plug';
	import * as Breadcrumb from '$lib/ui/breadcrumb';
	import { Button } from '$lib/ui/button';
	import * as Item from '$lib/ui/item';
	import ActionMenu from '$lib/ui/menu/action-menu.svelte';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import { ago } from '$lib/ui/format/time';
	import TabbedScreen from '$lib/ui/screen/tabbed-screen.svelte';
	import type { RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import { Skeleton } from '$lib/ui/skeleton';
	import Section from '$lib/ui/section/section.svelte';
	import { Spinner } from '$lib/ui/spinner';
	import StatePill from '$lib/ui/status/state-pill.svelte';
	import { cn } from '$lib/utils';
	import type { ConnectorOperation, McpServer } from './types';

	let {
		remote,
		server,
		now,
		back,
		online = true,
		justConnected = false,
		busy = false,
		operation,
		errorOperation,
		error = null,
		listHref = '/connectors',
		runHref = (id) => `/runs/${id}`,
		onaccept,
		onreconnect,
		ondisconnect,
		onremove,
		signInHref,
		onretry
	}: {
		remote: RemoteLike;
		/** null: no such server. */
		server?: McpServer | null;
		now: number;
		back: { href: string; label: string; onclick?: (e: MouseEvent) => void };
		online?: boolean;
		justConnected?: boolean;
		busy?: boolean;
		operation?: ConnectorOperation;
		errorOperation?: ConnectorOperation;
		error?: string | null;
		listHref?: string;
		runHref?: (id: string) => string;
		onreconnect?: () => void;
		ondisconnect?: () => void;
		onremove?: () => void;
		signInHref?: string;
		onaccept?: () => void;
		onretry?: () => void;
	} = $props();
	const uid = $props.id();
	const mark = { added: '+', removed: '−', changed: '~' };
	let removing = $state(false);
	let section = $state('tools');
	let shownServer = $state<string>();
	$effect(() => {
		if (server?.id !== shownServer) {
			shownServer = server?.id;
			section = 'tools';
			removing = false;
		}
	});
</script>

{#snippet banner()}
	{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}
{/snippet}

{#snippet skeleton()}
	<div class="flex flex-col gap-3" aria-hidden="true">
		<Skeleton class="h-4 w-2/3" />
		<Skeleton class="h-40 w-full rounded-xl" />
	</div>
	<p role="status" class="sr-only">Loading the server…</p>
{/snippet}

{#snippet trackingSnapshot()}
	{#if server?.changed}
		<div class="mt-6 flex flex-col gap-2 border-t pt-4">
			<Button class="self-start" variant="outline" disabled={busy || !online} onclick={onaccept}>
				{#if operation === 'snapshot'}<Spinner decorative />Saving…{:else}<Check />Save tracking
					snapshot{/if}
			</Button>
			<p class="text-xs text-muted-foreground">
				Optional: reset the tool comparison. Current tools are already available to the agent.
			</p>
		</div>
	{/if}
{/snippet}

{#snippet actions()}
	{#if server}
		<ActionMenu label="Connection actions">
			{#snippet children(close)}
				<Button
					variant="ghost"
					class="w-full justify-start"
					disabled={busy || !online}
					onclick={() => {
						close();
						onreconnect?.();
					}}>Reconnect</Button
				>
				{#if server.enabled !== false}<Button
						variant="ghost"
						class="w-full justify-start"
						disabled={busy || !online}
						onclick={() => {
							close();
							ondisconnect?.();
						}}>Disconnect</Button
					>{/if}
				{#if signInHref}<Button
						variant="ghost"
						class="w-full justify-start"
						href={signInHref}
						disabled={busy || !online}
						onclick={() => close()}>Sign in / replace token</Button
					>{/if}
				<Button
					variant="ghost"
					class="w-full justify-start"
					disabled={busy || !online}
					onclick={() => {
						close();
						removing = true;
					}}>Remove…</Button
				>
			{/snippet}
		</ActionMenu>
	{/if}
{/snippet}

{#snippet lead()}
	{#if server}
		<div class="flex flex-col gap-3">
			{#if justConnected}
				<p
					role="status"
					class="flex items-center gap-2 rounded-xl bg-review-soft px-3 py-2.5 text-sm text-review"
				>
					<Plug class="size-4 shrink-0" aria-hidden="true" />Connected. The agent can use these
					tools from its next turn.
				</p>
			{/if}
			<div class="flex flex-col gap-2">
				<span class="flex flex-wrap items-center gap-2">
					{#if operation && operation !== 'snapshot'}<StatePill
							of="running"
							label={operation === 'reconnect'
								? 'Reconnecting…'
								: operation === 'disconnect'
									? 'Disconnecting…'
									: 'Removing…'}
						/>
					{:else if server.enabled === false}<StatePill of="quiet" label="Disconnected" />
					{:else if server.status === 'connected'}<StatePill of="active" label="Connected" />
					{:else if server.status === 'signed-out'}<StatePill of="waiting" label="Sign in again" />
					{:else}<StatePill of="failed" label="Not working" />{/if}
				</span>
				<code class="font-mono text-xs [overflow-wrap:anywhere] text-muted-foreground"
					>{server.url}</code
				>
				{#if server.problem}<p class="text-sm">{server.problem}</p>{/if}
				{#if server.enabled === false}
					<Button class="self-start" disabled={busy || !online} onclick={onreconnect}
						>Reconnect now</Button
					>
				{:else if server.status === 'signed-out' && signInHref}
					<Button class="self-start" href={signInHref} disabled={busy || !online}>Sign in</Button>
				{:else if server.status === 'error'}
					<Button class="self-start" disabled={busy || !online} onclick={onreconnect}
						>Retry connection</Button
					>
				{/if}

				{#if removing}
					<p class="text-sm">
						Remove this connection and its saved credentials? Your account data stays with the
						provider.
					</p>
					<div class="flex flex-wrap gap-2 any-pointer-coarse:gap-4">
						<Button variant="outline" disabled={busy || !online} onclick={onremove}>
							<span class="grid"
								><span aria-hidden="true" class="invisible col-start-1 row-start-1"
									>Removing connection…</span
								><span class="col-start-1 row-start-1"
									>{operation === 'remove' ? 'Removing connection…' : 'Remove connection'}</span
								></span
							>
						</Button><Button variant="ghost" onclick={() => (removing = false)}>Cancel</Button>
					</div>
				{/if}
				{#if operation}<p role="status" class="sr-only">
						{operation === 'snapshot'
							? 'Saving tracking snapshot…'
							: operation === 'reconnect'
								? 'Reconnecting…'
								: operation === 'disconnect'
									? 'Disconnecting…'
									: 'Removing connection…'}
					</p>{/if}
				{#if error}<p role="alert" class="text-sm text-failed">
						{errorOperation === 'snapshot'
							? 'Couldn’t save the tracking snapshot.'
							: errorOperation === 'reconnect'
								? 'Couldn’t reconnect.'
								: errorOperation === 'disconnect'
									? 'Couldn’t disconnect.'
									: errorOperation === 'remove'
										? 'Couldn’t remove the connection.'
										: ''}
						{error}
					</p>{/if}
			</div>
		</div>
	{/if}
{/snippet}

{#snippet breadcrumb()}
	<Breadcrumb.Root>
		<Breadcrumb.List>
			<Breadcrumb.Item>
				<Breadcrumb.Link href={listHref}>Connectors</Breadcrumb.Link>
			</Breadcrumb.Item>
			<Breadcrumb.Separator />
			<Breadcrumb.Item>
				<Breadcrumb.Page>{server?.name ?? 'Server'}</Breadcrumb.Page>
			</Breadcrumb.Item>
		</Breadcrumb.List>
	</Breadcrumb.Root>
{/snippet}

<TabbedScreen
	title={server?.name ?? 'Server'}
	back={{ ...back, desktop: false }}
	{breadcrumb}
	{banner}
	{actions}
	state={{
		remote: server === null ? { status: 'ready' } : remote,
		isEmpty: server === null,
		empty: { title: 'No such server', body: 'It may have been removed.' },
		offline: !online,
		errorTitle: "Couldn't load this server.",
		onretry,
		skeleton
	}}
	tabs={[
		{ value: 'tools', label: 'Tools' },
		{ value: 'history', label: 'History' },
		{ value: 'used', label: 'Used by' }
	]}
	bind:value={section}
	label="Connection sections"
	{lead}
	hasContent={!!server}
>
	{#snippet children(tabValue)}
		{#if server}
			{#if tabValue === 'tools'}
				<Section id={`${uid}-tools`} title="Tools" class="gap-2">
					{#snippet aside()}list saved {ago(server.snapshotAt, now)}{/snippet}
					{#if server.changed}
						<p class="text-sm text-muted-foreground">
							Marked lines show changes since the saved snapshot. Added and changed tools are
							available without approval.
						</p>
					{/if}
					<ul class="flex flex-col divide-y rounded-xl border text-sm">
						{#each server.toolList as t (t.name)}
							<li
								class={cn(
									'grid grid-cols-[1.5rem_1fr] py-2 pr-3',
									t.change === 'added' && 'bg-add',
									t.change === 'removed' && 'bg-del'
								)}
							>
								<span class="text-center text-muted-foreground" aria-hidden="true"
									>{t.change ? mark[t.change] : ''}</span
								>
								<span class="flex min-w-0 flex-col gap-0.5">
									<span class="flex flex-wrap items-center gap-2">
										<code
											class={cn('font-mono text-code', t.change === 'removed' && 'line-through')}
											>{t.name}</code
										>
										{#if t.change}
											<span class="text-xs font-medium"
												>{t.change === 'added'
													? 'New on the server'
													: t.change === 'changed'
														? 'Definition changed'
														: 'Gone from the server'}</span
											>
										{/if}
									</span>
									<span class="[overflow-wrap:anywhere] text-muted-foreground">{t.description}</span
									>
								</span>
							</li>
						{/each}
					</ul>
				</Section>
				{@render trackingSnapshot()}
			{:else if tabValue === 'history'}
				<Section
					id={`${uid}-hist`}
					title="Connection history"
					description="Connection events and saved tool snapshots."
					class="gap-2"
				>
					{#if !server.history.length}<p class="text-sm text-muted-foreground">
							No connection events recorded yet.
						</p>{/if}
					<ol class="flex flex-col gap-2.5 border-l pl-4 text-sm">
						{#each server.history as h (h.at + h.event)}
							<li>
								<span class="text-xs text-muted-foreground">{ago(h.at, now)}</span>
								<p class="[overflow-wrap:anywhere]">{h.event}</p>
							</li>
						{/each}
					</ol>
				</Section>
			{:else if tabValue === 'used'}
				<Section
					id={`${uid}-used`}
					title="Runs using this connection"
					description="Open a run to see how the agent used these tools."
					class="gap-2"
				>
					{#if server.usedBy.length}
						<Item.Group variant="bordered">
							{#each server.usedBy as u (u.runId + u.tool)}
								<div role="listitem">
									<Item.Root size="sm">
										{#snippet child({ props })}
											<a href={runHref(u.runId)} {...props}>
												<Item.Content class="min-w-0">
													<Item.Title class="[overflow-wrap:anywhere]"
														>{u.title}<ArrowUpRight
															class="size-3.5 shrink-0"
															aria-hidden="true"
														/></Item.Title
													>
													<Item.Description class="text-xs"
														><code class="font-mono">{u.tool}</code> · {ago(
															u.at,
															now
														)}</Item.Description
													>
												</Item.Content>
											</a>
										{/snippet}
									</Item.Root>
								</div>
							{/each}
						</Item.Group>
					{:else}
						<p class="text-sm text-muted-foreground">No runs have used it yet.</p>
					{/if}
				</Section>
			{/if}
		{/if}
	{/snippet}
</TabbedScreen>
