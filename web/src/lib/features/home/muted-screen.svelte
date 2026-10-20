<script lang="ts">
	// What the owner muted with 👎 on job items. Labels are agent-written: plain text only.
	import type { HomeMute } from '$lib/core/realtime/events';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import { Button } from '$lib/ui/button';
	import { PageIntro } from '$lib/ui/page';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import Section from '$lib/ui/section/section.svelte';
	import { ago } from '$lib/ui/format/time';

	let {
		mutes,
		loaded,
		busy,
		error,
		lifted,
		online,
		now,
		back,
		onretry,
		onunmute
	}: {
		mutes: HomeMute[];
		loaded: boolean;
		busy: boolean;
		error: string | null;
		lifted: string | null;
		online: boolean;
		now: number;
		back: { href: string; label: string; desktop?: boolean };
		onretry: () => void;
		onunmute: (mute: HomeMute) => void;
	} = $props();
	const uid = $props.id();
	const topics = $derived(mutes.filter((m) => m.scope === 'topic'));
	const items = $derived(mutes.filter((m) => m.scope === 'item'));
</script>

{#snippet banner()}{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}{/snippet}
{#snippet list(rows: HomeMute[], empty: string)}
	{#if rows.length === 0}
		<p class="py-3 text-sm text-muted-foreground">{empty}</p>
	{:else}
		<ul class="divide-y">
			{#each rows as mute (mute.id)}
				<li class="flex min-w-0 items-center gap-3 py-3">
					<div class="flex min-w-0 flex-1 flex-col gap-0.5">
						<p class="text-sm font-medium [overflow-wrap:anywhere]">{mute.label}</p>
						<p class="text-xs text-muted-foreground">Muted {ago(mute.at, now)} · {mute.job}</p>
					</div>
					<Button
						variant="outline"
						size="sm"
						disabled={busy || !online}
						aria-label="Unmute {mute.label}"
						onclick={() => onunmute(mute)}>Unmute</Button
					>
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

<DetailScreen title="Muted topics" {back} {banner}>
	<ScreenContent>
		<div class="flex flex-col gap-8">
			<PageIntro
				description="Things you marked not useful on Home. Scheduled jobs and the heartbeat don't flag these, until you unmute them."
			/>
			{#if error}<div role="alert" class="flex flex-wrap items-center gap-3">
					<p class="text-sm text-failed">{error}</p>
					{#if !loaded}<Button variant="outline" disabled={busy || !online} onclick={onretry}
							>Retry</Button
						>{/if}
				</div>{/if}
			{#if lifted}<p role="status" class="text-sm">
					Unmuted “{lifted}”. Jobs can flag it again.
				</p>{/if}
			{#if !loaded && busy}<p role="status" class="text-sm text-muted-foreground">
					Loading muted topics…
				</p>{/if}
			{#if loaded}
				<Section id="{uid}-topics" title="Topics" tone="list">
					{@render list(
						topics,
						'No muted topics. Select Not useful on a Home item to stop jobs flagging its kind.'
					)}
				</Section>
				<Section id="{uid}-items" title="Single items" tone="list">
					{@render list(items, 'No single items muted.')}
				</Section>
			{/if}
		</div>
	</ScreenContent>
</DetailScreen>
