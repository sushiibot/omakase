<script lang="ts">
	import Archive from '@lucide/svelte/icons/archive';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import * as Breadcrumb from '$lib/ui/breadcrumb';
	import { Button } from '$lib/ui/button';
	import * as Card from '$lib/ui/card';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
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
	import type { SkillDetail } from './types';

	let {
		remote,
		skill,
		now,
		back,
		online = true,
		busy = false,
		error = null,
		skillsHref = '/skills',
		runHref = (id) => `/runs/${id}`,
		versionsHref = (name) => `/skills/${name}/versions`,
		onsetstage,
		onretry
	}: {
		remote: RemoteLike;
		/** null: no such skill. */
		skill?: SkillDetail | null;
		now: number;
		back: { href: string; label: string; onclick?: (e: MouseEvent) => void };
		online?: boolean;
		busy?: boolean;
		error?: string | null;
		skillsHref?: string;
		runHref?: (id: string) => string;
		versionsHref?: (name: string) => string;
		onsetstage?: (stage: 'active' | 'archived') => void;
		onretry?: () => void;
	} = $props();
	const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n * 100)}%`);
</script>

{#snippet banner()}
	{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}
{/snippet}

{#snippet skeleton()}
	<div class="flex flex-col gap-3 p-4 md:p-6" aria-hidden="true">
		<Skeleton class="h-6 w-1/2" />
		<Skeleton class="h-16 w-full rounded-xl" />
		<Skeleton class="h-4 w-4/5" />
	</div>
	<p role="status" class="sr-only">Loading the skill…</p>
{/snippet}

{#snippet footer()}
	{#if skill && skill.stage !== 'archived'}
		<ScreenFooter>
			{#if error}<p role="alert" class="text-sm text-failed">Couldn't change it. {error}</p>{/if}
			<div class="flex gap-2 md:justify-end any-pointer-coarse:gap-4">
				<Button
					size="lg"
					variant="outline"
					class="max-md:flex-1"
					disabled={busy || !online}
					onclick={() => onsetstage?.('archived')}><Archive />Archive</Button
				>
				{#if skill.stage === 'draft' || skill.stage === 'stale'}
					<Button
						size="lg"
						class="max-md:flex-1"
						disabled={busy || !online}
						onclick={() => onsetstage?.('active')}
					>
						{#if busy}<Spinner decorative />Saving…{:else}{skill.stage === 'draft'
								? 'Use it now'
								: 'Mark in use'}{/if}
					</Button>
				{/if}
			</div>
		</ScreenFooter>
	{/if}
{/snippet}

{#snippet breadcrumb()}
	<Breadcrumb.Root>
		<Breadcrumb.List class="flex-nowrap">
			<Breadcrumb.Item><Breadcrumb.Link href={skillsHref}>Skills</Breadcrumb.Link></Breadcrumb.Item>
			<Breadcrumb.Separator />
			<Breadcrumb.Item class="min-w-0">
				<Breadcrumb.Page class="truncate font-mono">{skill?.name}</Breadcrumb.Page>
			</Breadcrumb.Item>
		</Breadcrumb.List>
	</Breadcrumb.Root>
{/snippet}

<DetailScreen
	title={skill?.name ?? 'Skill'}
	back={skill ? { ...back, desktop: false } : back}
	breadcrumb={skill ? breadcrumb : undefined}
	{banner}
	footer={skill ? footer : undefined}
	state={{
		remote: skill === null ? { status: 'ready' } : remote,
		isEmpty: skill === null,
		empty: { title: 'No such skill', body: 'It may have been merged into another skill.' },
		offline: !online,
		errorTitle: "Couldn't load this skill.",
		onretry,
		skeleton
	}}
>
	{#if skill}
		<ScreenContent>
			<PageIntro description={skill.description}>
				{#snippet actions()}<StatePill of={skill.stage} />{/snippet}
			</PageIntro>

			<Card.Root size="sm">
				<dl class="grid grid-cols-3 divide-x">
					{#each [['Loaded', `${skill.uses} runs`], ['Verified', pct(skill.successRate)], ['Last used', skill.lastUsed ? ago(skill.lastUsed, now) : 'Never']] as [k, v] (k)}
						<div class="flex min-w-0 flex-col gap-1 px-(--card-spacing)">
							<dt class="text-xs text-muted-foreground">{k}</dt>
							<dd class="font-medium [overflow-wrap:break-word] tabular-nums">{v}</dd>
						</div>
					{/each}
				</dl>
			</Card.Root>

			<Section title="Why it's {skill.stage === 'active' ? 'in use' : skill.stage}">
				<p class="text-sm">{skill.why}</p>
			</Section>

			<Item.Root variant="outline" size="sm">
				{#snippet child({ props })}
					<a href={versionsHref(skill.name)} {...props}>
						<Item.Content>
							<Item.Title>Versions and SKILL.md</Item.Title>
							<Item.Description
								>Version {skill.version}, {skill.versions.length}
								{skill.versions.length === 1 ? 'change' : 'changes'} with diffs</Item.Description
							>
						</Item.Content>
						<Item.Actions>
							<ChevronRight class="size-4 text-muted-foreground" aria-hidden="true" />
						</Item.Actions>
					</a>
				{/snippet}
			</Item.Root>

			<Section title="Lifecycle">
				<ol class="flex flex-col gap-3 border-l pl-4">
					{#each skill.history as h (h.at + h.event)}
						<li class="relative text-sm">
							<span
								class="absolute top-1.5 -left-5.25 size-2 rounded-full bg-foreground/40"
								aria-hidden="true"
							></span>
							<span class="font-medium">{h.event}</span>
							<span class="text-muted-foreground"> · {ago(h.at, now)}</span>
							<p class="text-muted-foreground">{h.reason}</p>
						</li>
					{/each}
				</ol>
			</Section>

			{#if skill.runs.length}
				<Section title="Runs that loaded it">
					<Item.Group variant="bordered">
						{#each skill.runs as r (r.id)}
							<div role="listitem">
								<Item.Root size="sm" class="any-pointer-coarse:min-h-11">
									{#snippet child({ props })}
										<a href={runHref(r.id)} {...props}>
											<Item.Media variant="icon">
												{#if r.ok}
													<CircleCheck class="text-review" aria-hidden="true" />
												{:else}
													<CircleX class="text-failed" aria-hidden="true" />
												{/if}
											</Item.Media>
											<Item.Content class="min-w-0">
												<Item.Title class="line-clamp-none"
													><span class="sr-only">{r.ok ? 'Verified:' : 'Failed:'}</span>
													{r.title}</Item.Title
												>
											</Item.Content>
											<Item.Actions>
												<span class="text-xs text-muted-foreground">{ago(r.at, now)}</span>
											</Item.Actions>
										</a>
									{/snippet}
								</Item.Root>
							</div>
						{/each}
					</Item.Group>
				</Section>
			{/if}
		</ScreenContent>
	{/if}
</DetailScreen>
