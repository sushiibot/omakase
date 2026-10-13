<script lang="ts">
	import { Markdown } from '$lib/features/chat';
	import * as Breadcrumb from '$lib/ui/breadcrumb';
	import * as Card from '$lib/ui/card';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import { ago } from '$lib/ui/format/time';
	import * as Item from '$lib/ui/item';
	import { PageIntro } from '$lib/ui/page';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import type { RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import Section from '$lib/ui/section/section.svelte';
	import { Skeleton } from '$lib/ui/skeleton';
	import WriteRow from './components/write-row.svelte';
	import type { MemoryFileDetail } from './types';

	let {
		remote,
		detail,
		now,
		back,
		online = true,
		writeHref = (id) => `/memory/writes/${id}`,
		onretry
	}: {
		remote: RemoteLike;
		/** null: no such file. */
		detail?: MemoryFileDetail | null;
		now: number;
		back: { href: string; label: string; onclick?: (e: MouseEvent) => void };
		online?: boolean;
		writeHref?: (id: string) => string;
		onretry?: () => void;
	} = $props();
</script>

{#snippet banner()}
	{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}
{/snippet}

{#snippet skeleton()}
	<div class="flex flex-col gap-3 p-4 md:p-6" aria-hidden="true">
		<Skeleton class="h-3 w-1/3" />
		{#each [0, 1, 2, 3] as i (i)}<Skeleton class="h-4 w-full" />{/each}
	</div>
	<p role="status" class="sr-only">Loading the file…</p>
{/snippet}

{#snippet breadcrumb()}
	<Breadcrumb.Root>
		<Breadcrumb.List>
			<Breadcrumb.Item><Breadcrumb.Link href={back.href}>Memory</Breadcrumb.Link></Breadcrumb.Item>
			<Breadcrumb.Separator />
			<Breadcrumb.Item>
				<Breadcrumb.Page class="font-mono">{detail?.file.path}</Breadcrumb.Page>
			</Breadcrumb.Item>
		</Breadcrumb.List>
	</Breadcrumb.Root>
{/snippet}

<DetailScreen
	title={detail?.file.path ?? 'Memory file'}
	back={detail ? { ...back, desktop: false } : back}
	breadcrumb={detail ? breadcrumb : undefined}
	{banner}
	state={{
		remote: detail === null ? { status: 'ready' } : remote,
		isEmpty: detail === null,
		empty: { title: 'No such file', body: 'The agent may have merged or removed it.' },
		offline: !online,
		errorTitle: "Couldn't load this file.",
		onretry,
		skeleton
	}}
>
	{#if detail}
		<ScreenContent>
			<PageIntro description="{detail.file.about}. Changed {ago(detail.file.updatedAt, now)}." />
			{#if detail.file.truncated}<p role="status" class="text-sm text-muted-foreground">
					This file is large. Showing the first 256 KB.
				</p>{/if}
			<section aria-label="What the file says">
				<Card.Root>
					<Card.Content class="text-body"><Markdown text={detail.file.content} /></Card.Content>
				</Card.Root>
			</section>
			{#if detail.writes.length}
				<Section title="Changes to this file" tone="list">
					<Item.Group class="gap-0">
						{#each detail.writes as w (w.id)}
							<div role="listitem"><WriteRow write={w} {now} href={writeHref(w.id)} /></div>
						{/each}
					</Item.Group>
				</Section>
			{/if}
		</ScreenContent>
	{/if}
</DetailScreen>
