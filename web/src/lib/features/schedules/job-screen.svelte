<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import FlaskConical from '@lucide/svelte/icons/flask-conical';
	import * as Breadcrumb from '$lib/ui/breadcrumb';
	import { Button } from '$lib/ui/button';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import * as Field from '$lib/ui/field';
	import { ago } from '$lib/ui/format/time';
	import * as Item from '$lib/ui/item';
	import { PageIntro } from '$lib/ui/page';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import ScreenFooter from '$lib/ui/screen/screen-footer.svelte';
	import type { RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import Section from '$lib/ui/section/section.svelte';
	import { Skeleton } from '$lib/ui/skeleton';
	import { Spinner } from '$lib/ui/spinner';
	import StatePill from '$lib/ui/status/state-pill.svelte';
	import { Switch } from '$lib/ui/switch';
	import { nextRunLine } from './format';
	import type { JobDetail, TestRun } from './types';

	let {
		remote,
		job,
		now,
		back,
		online = true,
		busy = false,
		error = null,
		test,
		schedulesHref = '/schedules',
		runHref = (id) => `/runs/${id}`,
		ontoggle,
		ontest,
		onretry
	}: {
		remote: RemoteLike;
		/** null: no such job. */
		job?: JobDetail | null;
		now: number;
		back: { href: string; label: string; onclick?: (e: MouseEvent) => void };
		online?: boolean;
		busy?: boolean;
		error?: string | null;
		test?: TestRun;
		schedulesHref?: string;
		runHref?: (id: string) => string;
		ontoggle?: (enabled: boolean) => void;
		ontest?: () => void;
		onretry?: () => void;
	} = $props();
	const uid = $props.id();
</script>

{#snippet banner()}
	{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}
{/snippet}

{#snippet skeleton()}
	<div class="flex flex-col gap-3 p-4 md:p-6" aria-hidden="true">
		<Skeleton class="h-6 w-1/2" />
		<Skeleton class="h-12 w-full rounded-xl" />
		<Skeleton class="h-24 w-full rounded-xl" />
	</div>
	<p role="status" class="sr-only">Loading the job…</p>
{/snippet}

{#snippet footer()}
	{#if job}
		<ScreenFooter>
			{#if test}
				<Item.Root variant="outline" size="sm" role="status">
					<Item.Content>
						{#if test.state === 'running'}
							<p class="flex items-center gap-2 text-running">
								<Spinner decorative />{test.step}…
							</p>
						{:else if test.state === 'done'}
							<span class="flex flex-wrap items-center gap-2"
								><span class="font-medium">Test run</span><StatePill of={test.result} /></span
							>
							<p class="text-muted-foreground">{test.note}</p>
						{:else}
							<p class="text-failed">The test run didn't start. {test.note}</p>
						{/if}
					</Item.Content>
				</Item.Root>
			{/if}
			<div class="flex flex-col gap-2 md:flex-row-reverse md:items-center">
				<Button variant="outline" disabled={test?.state === 'running' || !online} onclick={ontest}>
					<FlaskConical />{test && test.state !== 'running' ? 'Test again' : 'Test run'}
				</Button>
				<p class="text-center text-xs text-muted-foreground md:flex-1 md:text-right">
					{online
						? 'Runs it now with sending turned off.'
						: "You're offline. A test run needs the agent."}
				</p>
			</div>
		</ScreenFooter>
	{/if}
{/snippet}

{#snippet breadcrumb()}
	<Breadcrumb.Root>
		<Breadcrumb.List class="flex-nowrap">
			<Breadcrumb.Item
				><Breadcrumb.Link href={schedulesHref}>Schedules</Breadcrumb.Link></Breadcrumb.Item
			>
			<Breadcrumb.Separator />
			<Breadcrumb.Item class="min-w-0"
				><Breadcrumb.Page class="truncate">{job?.name}</Breadcrumb.Page></Breadcrumb.Item
			>
		</Breadcrumb.List>
	</Breadcrumb.Root>
{/snippet}

<DetailScreen
	title={job?.name ?? 'Job'}
	back={job ? { ...back, desktop: false } : back}
	breadcrumb={job ? breadcrumb : undefined}
	{banner}
	footer={job ? footer : undefined}
	state={{
		remote: job === null ? { status: 'ready' } : remote,
		isEmpty: job === null,
		empty: { title: 'No such job', body: 'It may have been deleted in chat.' },
		offline: !online,
		errorTitle: "Couldn't load this job.",
		onretry,
		skeleton
	}}
>
	{#if job}
		<ScreenContent>
			<PageIntro>
				{#snippet description()}
					<p class="font-medium text-foreground">{job.schedule}</p>
					<p class="tabular-nums">{nextRunLine(job, now)}</p>
				{/snippet}
			</PageIntro>
			<Field.Label for="{uid}-enabled">
				<Field.Field orientation="horizontal">
					<Field.Content>
						<Field.Title id="{uid}-enabled-label">Runs on its schedule</Field.Title>
						<Field.Description id="{uid}-enabled-description"
							>{job.enabled
								? 'On.'
								: 'Paused. It won’t run until you turn it on.'}</Field.Description
						>
					</Field.Content>
					<Switch
						id="{uid}-enabled"
						aria-labelledby="{uid}-enabled-label"
						aria-describedby="{uid}-enabled-description"
						bind:checked={() => job.enabled, (v) => ontoggle?.(v)}
						disabled={busy || !online}
					/>
				</Field.Field>
			</Field.Label>
			{#if error}<p role="alert" class="text-sm text-failed">Couldn't change it. {error}</p>{/if}
			<Section title="What it asks the agent">
				<p class="rounded-xl bg-muted px-3 py-2.5 text-sm [overflow-wrap:anywhere]">{job.prompt}</p>
			</Section>
			<Section title="Recent runs">
				{#if job.runs.length}
					<Item.Group variant="bordered">
						{#each job.runs as r (r.at)}
							<div role="listitem">
								{#if r.runId}
									<Item.Root size="sm" class="any-pointer-coarse:min-h-11">
										{#snippet child({ props })}
											<a href={runHref(r.runId!)} {...props}>
												{@render runLine(r)}
												<Item.Actions>
													<ArrowUpRight class="size-3.5 text-muted-foreground" aria-hidden="true" />
												</Item.Actions>
											</a>
										{/snippet}
									</Item.Root>
								{:else}
									<Item.Root size="sm" class="any-pointer-coarse:min-h-11"
										>{@render runLine(r)}</Item.Root
									>
								{/if}
							</div>
						{/each}
					</Item.Group>
				{:else}
					<p class="text-sm text-muted-foreground">It hasn't run yet.</p>
				{/if}
			</Section>
		</ScreenContent>
	{/if}
</DetailScreen>

{#snippet runLine(r: JobDetail['runs'][number])}
	<Item.Content class="min-w-0 flex-row flex-wrap items-center gap-x-3 gap-y-1">
		<span class="w-28 shrink-0 text-muted-foreground tabular-nums">{ago(r.at, now)}</span>
		<StatePill of={r.result} />
		<span class="min-w-0 flex-1 basis-40 [overflow-wrap:anywhere] text-muted-foreground"
			>{r.note}</span
		>
	</Item.Content>
{/snippet}
