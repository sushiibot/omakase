<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Bot from '@lucide/svelte/icons/bot';
	import Globe from '@lucide/svelte/icons/globe';
	import Hand from '@lucide/svelte/icons/hand';
	import Lock from '@lucide/svelte/icons/lock';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { Button } from '$lib/ui/button';
	import * as Card from '$lib/ui/card';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import { ago } from '$lib/ui/format/time';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import ScreenFooter from '$lib/ui/screen/screen-footer.svelte';
	import type { RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import { Skeleton } from '$lib/ui/skeleton';
	import { Spinner } from '$lib/ui/spinner';
	import { cn } from '$lib/utils';
	import type { BrowserPending, BrowserStatus } from './types';

	let {
		remote,
		status,
		now,
		back,
		online = true,
		pending = null,
		error = null,
		runHref = (id) => `/runs/${id}`,
		ontakeover,
		onhandback,
		onretry
	}: {
		remote: RemoteLike;
		status?: BrowserStatus;
		now: number;
		back?: { href: string; label: string; onclick?: (e: MouseEvent) => void };
		online?: boolean;
		pending?: BrowserPending;
		error?: string | null;
		runHref?: (id: string) => string;
		ontakeover?: () => void;
		onhandback?: () => void;
		onretry?: () => void;
	} = $props();

	const steps = [
		{ id: 'agent', label: 'The agent drives' },
		{ id: 'you', label: 'You drive' },
		{ id: 'back', label: 'Hand back' }
	];
	const step = $derived(status?.holder === 'you' ? (pending === 'handing' ? 2 : 1) : 0);
</script>

{#snippet banner()}
	{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}
{/snippet}

{#snippet skeleton()}
	<div class="flex flex-col gap-3 p-4 md:p-6" aria-hidden="true">
		<Skeleton class="h-10 w-full rounded-xl" />
		<Skeleton class="aspect-[3/4] w-full rounded-xl" />
	</div>
	<p role="status" class="sr-only">Checking the browser…</p>
{/snippet}

{#snippet footer()}
	{#if status && status.holder !== 'idle'}
		<ScreenFooter>
			{#if error}<p role="alert" class="text-sm text-failed">{error}</p>{/if}
			{#if status.holder === 'agent'}
				<Button size="lg" class="md:self-end" disabled={!!pending || !online} onclick={ontakeover}>
					{#if pending === 'taking'}<Spinner
							class="motion-reduce:animate-none"
							aria-hidden="true"
						/>Waiting for the agent to let go…{:else}<Hand />Take over the browser{/if}
				</Button>
				<p class="text-center text-xs text-muted-foreground md:text-right">
					The agent pauses and can't touch the browser until you hand it back.
				</p>
			{:else}
				<Button
					size="lg"
					variant="outline"
					class="md:self-end"
					disabled={!!pending || !online}
					onclick={onhandback}
				>
					{#if pending === 'handing'}<Spinner
							class="motion-reduce:animate-none"
							aria-hidden="true"
						/>Handing back…{:else}<Undo2 />Hand back to the agent{/if}
				</Button>
			{/if}
		</ScreenFooter>
	{/if}
{/snippet}

<DetailScreen
	title="Browser"
	{back}
	{banner}
	footer={status ? footer : undefined}
	state={{
		remote,
		isEmpty: status?.holder === 'idle',
		empty: {
			title: 'The agent isn’t using the browser',
			body: 'When it opens a page that needs you, like a sign-in or a code, you can take over here.'
		},
		offline: !online,
		errorTitle: "Couldn't reach the browser.",
		onretry,
		skeleton
	}}
>
	{#if status && status.holder !== 'idle'}
		<ScreenContent>
			<ol class="grid grid-cols-3 gap-2 text-xs" aria-label="Takeover steps">
				{#each steps as s, i (s.id)}
					<li
						aria-current={i === step ? 'step' : undefined}
						class={cn('flex flex-col gap-1.5', i > step ? 'text-muted-foreground' : 'font-medium')}
					>
						<span class={cn('h-1 rounded-full', i <= step ? 'bg-foreground' : 'bg-muted')}></span>
						{s.label}
					</li>
				{/each}
			</ol>

			<p
				role="status"
				class={cn(
					'flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm',
					status.holder === 'you' ? 'bg-running-soft text-running' : 'bg-muted'
				)}
			>
				{#if status.holder === 'you'}
					<Lock class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<span
						>You're driving{#if status.since}, since {ago(status.since, now)}{/if}. The agent is
						locked out until you hand back.</span
					>
				{:else}
					<Bot class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<span
						>The agent is using the browser{#if status.since}, since {ago(
								status.since,
								now
							)}{/if}.</span
					>
				{/if}
			</p>

			<Card.Root class="gap-0 py-0">
				<figure class="flex flex-col">
					<figcaption class="flex items-center gap-2 border-b bg-muted/50 px-(--card-spacing) py-2">
						<Globe class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						<span class="sr-only">Address:</span>
						<code class="min-w-0 font-mono text-xs [overflow-wrap:anywhere]">{status.url}</code>
					</figcaption>
					<div
						class="grid aspect-[3/4] max-h-96 w-full place-items-center bg-muted/40 px-6 text-center text-sm text-muted-foreground"
					>
						The live view of the page goes here. It isn't built yet: this screen shows the steps
						only.
					</div>
				</figure>
			</Card.Root>

			{#if status.task}
				<Button
					variant="link"
					href={runHref(status.task.runId)}
					class="h-auto min-h-8 self-start px-0 text-left [overflow-wrap:anywhere] whitespace-normal"
					>For: {status.task.title}<ArrowUpRight aria-hidden="true" /></Button
				>
			{/if}
		</ScreenContent>
	{/if}
</DetailScreen>
