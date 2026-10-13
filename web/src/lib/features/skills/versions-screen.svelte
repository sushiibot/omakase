<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { Markdown } from '$lib/features/chat';
	import * as Breadcrumb from '$lib/ui/breadcrumb';
	import { Button } from '$lib/ui/button';
	import * as Card from '$lib/ui/card';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import DiffView from '$lib/ui/diff/diff-view.svelte';
	import { ago } from '$lib/ui/format/time';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import type { RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import Section from '$lib/ui/section/section.svelte';
	import { Skeleton } from '$lib/ui/skeleton';
	import type { SkillDetail } from './types';

	let {
		remote,
		skill,
		now,
		back,
		online = true,
		open = [],
		skillsHref = '/skills',
		runHref = (id) => `/runs/${id}`,
		onretry
	}: {
		remote: RemoteLike;
		skill?: SkillDetail | null;
		now: number;
		back: { href: string; label: string; onclick?: (e: MouseEvent) => void };
		online?: boolean;
		/** Versions whose diff starts open; the newest is open by default. */
		open?: number[];
		skillsHref?: string;
		runHref?: (id: string) => string;
		onretry?: () => void;
	} = $props();
</script>

{#snippet banner()}
	{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}
{/snippet}

{#snippet skeleton()}
	<div class="flex flex-col gap-3 p-4 md:p-6" aria-hidden="true">
		<Skeleton class="h-24 w-full rounded-xl" />
		<Skeleton class="h-12 w-full rounded-xl" />
	</div>
	<p role="status" class="sr-only">Loading versions…</p>
{/snippet}

{#snippet breadcrumb()}
	<Breadcrumb.Root>
		<Breadcrumb.List>
			<Breadcrumb.Item><Breadcrumb.Link href={skillsHref}>Skills</Breadcrumb.Link></Breadcrumb.Item>
			<Breadcrumb.Separator />
			<Breadcrumb.Item>
				<Breadcrumb.Link href={back.href} class="font-mono">{skill?.name}</Breadcrumb.Link>
			</Breadcrumb.Item>
			<Breadcrumb.Separator />
			<Breadcrumb.Item><Breadcrumb.Page>Versions</Breadcrumb.Page></Breadcrumb.Item>
		</Breadcrumb.List>
	</Breadcrumb.Root>
{/snippet}

<DetailScreen
	title={skill ? `${skill.name} versions` : 'Versions'}
	back={skill ? { ...back, desktop: false } : back}
	breadcrumb={skill ? breadcrumb : undefined}
	{banner}
	state={{
		remote: skill === null ? { status: 'ready' } : remote,
		isEmpty: skill === null,
		empty: { title: 'No such skill', body: 'It may have been merged into another skill.' },
		offline: !online,
		errorTitle: "Couldn't load the versions.",
		onretry,
		skeleton
	}}
>
	{#if skill}
		<ScreenContent>
			<Section title="SKILL.md now, version {skill.version}">
				<Card.Root>
					<Card.Content class="text-body"><Markdown text={skill.content} /></Card.Content>
				</Card.Root>
			</Section>
			<Section title="History">
				{#if skill.versions.length}
					<ol class="flex flex-col gap-2">
						{#each skill.versions as v, i (v.version)}
							<li>
								<details
									class="group rounded-xl border"
									open={open.length ? open.includes(v.version) : i === 0}
								>
									<summary
										class="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 [&::-webkit-details-marker]:hidden"
									>
										<span class="flex min-w-0 flex-1 flex-col gap-1">
											<span class="text-sm font-medium">Version {v.version}</span>
											<span class="text-sm text-muted-foreground"
												>{ago(v.at, now)} · {v.reason}</span
											>
										</span>
										<ChevronDown
											class="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
											aria-hidden="true"
										/>
									</summary>
									<div class="flex flex-col gap-2 px-3 pb-3">
										<DiffView lines={v.diff} file="SKILL.md" />
										{#if v.run}
											<Button
												variant="link"
												href={runHref(v.run.id)}
												class="h-auto min-h-8 self-start px-0 text-left [overflow-wrap:anywhere] whitespace-normal"
												>Written during {v.run.title}<ArrowUpRight aria-hidden="true" /></Button
											>
										{/if}
									</div>
								</details>
							</li>
						{/each}
					</ol>
				{:else}
					<p class="text-sm text-muted-foreground">No saved versions.</p>
				{/if}
			</Section>
		</ScreenContent>
	{/if}
</DetailScreen>
