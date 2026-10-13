<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import GitCommitHorizontal from '@lucide/svelte/icons/git-commit-horizontal';
	import Redo2 from '@lucide/svelte/icons/redo-2';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import * as Breadcrumb from '$lib/ui/breadcrumb';
	import { Button } from '$lib/ui/button';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import DiffView from '$lib/ui/diff/diff-view.svelte';
	import { ago } from '$lib/ui/format/time';
	import { PageIntro } from '$lib/ui/page';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import ScreenFooter from '$lib/ui/screen/screen-footer.svelte';
	import type { RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import Section from '$lib/ui/section/section.svelte';
	import { Skeleton } from '$lib/ui/skeleton';
	import { Spinner } from '$lib/ui/spinner';
	import StatePill from '$lib/ui/status/state-pill.svelte';
	import type { MemoryWriteRecord } from './types';

	let {
		remote,
		write,
		now,
		back,
		online = true,
		busy = false,
		result = null,
		memoryHref = '/memory',
		runHref = (id) => `/runs/${id}`,
		threadHref = (id) => `/chats/${id}`,
		fileHref = (id) => `/memory/files/${id}`,
		onrevert,
		onrestore,
		onretry
	}: {
		remote: RemoteLike;
		/** null: no such change. */
		write?: MemoryWriteRecord | null;
		now: number;
		back: { href: string; label: string; onclick?: (e: MouseEvent) => void };
		online?: boolean;
		busy?: boolean;
		/** What the last revert or restore did, for the toast. */
		result?: { kind: 'reverted' | 'restored' | 'failed'; text: string } | null;
		memoryHref?: string;
		runHref?: (id: string) => string;
		threadHref?: (id: string) => string;
		fileHref?: (id: string) => string;
		onrevert?: () => void;
		onrestore?: () => void;
		onretry?: () => void;
	} = $props();
</script>

{#snippet banner()}
	{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}
{/snippet}

{#snippet skeleton()}
	<div class="flex flex-col gap-3 p-4 md:p-6" aria-hidden="true">
		<Skeleton class="h-3 w-1/3" />
		<Skeleton class="h-6 w-4/5" />
		<Skeleton class="h-28 w-full rounded-xl" />
	</div>
	<p role="status" class="sr-only">Loading the change…</p>
{/snippet}

{#snippet toast()}
	<span class="flex-1">{result?.text}</span>
	{#if result?.kind === 'reverted'}
		<Button
			variant="link"
			class="-my-2 h-auto shrink-0 px-0 font-semibold text-background underline underline-offset-2"
			onclick={onrestore}>Restore</Button
		>
	{/if}
{/snippet}

{#snippet footer()}
	{#if write}
		<ScreenFooter>
			{#if write.reverted}
				<Button
					size="lg"
					variant="outline"
					class="md:self-end"
					disabled={busy || !online}
					onclick={onrestore}
				>
					{#if busy}<Spinner decorative />Restoring…{:else}<Redo2 />Restore this change{/if}
				</Button>
			{:else}
				<Button
					size="lg"
					variant="outline"
					class="md:self-end"
					disabled={busy || !online}
					onclick={onrevert}
				>
					{#if busy}<Spinner decorative />Reverting…{:else}<Undo2 />Revert this change{/if}
				</Button>
			{/if}
			{#if !online}
				<p class="text-center text-xs text-muted-foreground md:text-right">
					You're offline. Undo needs the agent.
				</p>
			{/if}
		</ScreenFooter>
	{/if}
{/snippet}

{#snippet breadcrumb()}
	<Breadcrumb.Root>
		<Breadcrumb.List class="flex-nowrap">
			<Breadcrumb.Item><Breadcrumb.Link href={memoryHref}>Memory</Breadcrumb.Link></Breadcrumb.Item>
			<Breadcrumb.Separator />
			{#if write}
				<Breadcrumb.Item class="min-w-0">
					<Breadcrumb.Link href={fileHref(write.fileId)} class="truncate font-mono"
						>{write.path}</Breadcrumb.Link
					>
				</Breadcrumb.Item>
				<Breadcrumb.Separator />
			{/if}
			<Breadcrumb.Item><Breadcrumb.Page>Change</Breadcrumb.Page></Breadcrumb.Item>
		</Breadcrumb.List>
	</Breadcrumb.Root>
{/snippet}

<DetailScreen
	title="Memory change"
	back={write ? { ...back, desktop: false } : back}
	breadcrumb={write ? breadcrumb : undefined}
	{banner}
	footer={write ? footer : undefined}
	toast={result ? toast : undefined}
	state={{
		remote: write === null ? { status: 'ready' } : remote,
		isEmpty: write === null,
		empty: {
			title: 'No such change',
			body: 'It may have been tidied away. Memory lists every change that is still there.'
		},
		offline: !online,
		errorTitle: "Couldn't load this change.",
		onretry,
		skeleton
	}}
>
	{#if write}
		<ScreenContent>
			<div class="flex flex-col gap-1">
				<Button
					variant="link"
					href={fileHref(write.fileId)}
					class="h-auto min-h-8 self-start px-0 text-left font-mono text-xs font-normal [overflow-wrap:anywhere] whitespace-normal text-muted-foreground hover:text-foreground md:hidden"
					>{write.path}</Button
				>
				<PageIntro title={write.summary}>
					{#snippet description()}
						<p class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
							<span class="tabular-nums">{ago(write.at, now)}</span>
							<span class="inline-flex items-center gap-1 font-mono text-xs">
								<GitCommitHorizontal class="size-3.5" aria-hidden="true" />{write.commit}
							</span>
							{#if write.taint}<StatePill of="tainted" label={write.taint} />{/if}
							{#if write.reverted}<StatePill of="archived" label="Reverted" />{/if}
						</p>
					{/snippet}
				</PageIntro>
			</div>

			<DiffView lines={write.diff} file={write.path} />

			{#if write.reverted}
				<p class="text-sm text-muted-foreground">
					Reverted {ago(write.reverted.at, now)} in
					<span class="font-mono text-xs">{write.reverted.commit}</span>. The agent doesn't see
					these lines any more.
				</p>
			{/if}

			<Section title="Written by">
				<div class="flex flex-col items-start gap-2 any-pointer-coarse:gap-4">
					{#if write.run}
						<Button
							variant="link"
							href={runHref(write.run.id)}
							class="h-auto min-h-8 px-0 text-left [overflow-wrap:anywhere] whitespace-normal"
							>{write.run.title}<ArrowUpRight aria-hidden="true" /></Button
						>
					{/if}
					{#if write.thread}
						<Button
							variant="link"
							href={threadHref(write.thread.id)}
							class="h-auto min-h-8 px-0 text-left [overflow-wrap:anywhere] whitespace-normal"
							>Thread · {write.thread.title}<ArrowUpRight aria-hidden="true" /></Button
						>
					{/if}
				</div>
				{#if write.taint}
					<p class="text-sm text-muted-foreground">
						That run had read content from outside before it wrote this. Check it before the agent
						relies on it.
					</p>
				{/if}
			</Section>
		</ScreenContent>
	{/if}
</DetailScreen>
