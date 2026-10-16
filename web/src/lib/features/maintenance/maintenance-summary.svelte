<script lang="ts">
	import { Button } from '$lib/ui/button';
	import Section from '$lib/ui/section/section.svelte';
	import type { MaintenanceView } from './types';
	let {
		view,
		mode,
		busy = false,
		error,
		onpause
	}: {
		view?: MaintenanceView;
		mode: 'needs' | 'updates' | 'watching';
		busy?: boolean;
		error?: string | null;
		onpause: (paused: boolean) => void;
	} = $props();
	const pending = $derived(
		view?.proposals.filter((p) =>
			['pending', 'uncertain', 'executing', 'undoing'].includes(p.status)
		) ?? []
	);
	const receipts = $derived(
		view?.proposals
			.filter((p) => ['completed', 'undone', 'conflict'].includes(p.status))
			.slice(0, 4) ?? []
	);
</script>

{#if mode === 'needs' && pending.length}
	<Section
		title="Calendar updates"
		description="Review the details before anything changes."
		count={pending.length}
	>
		<div class="divide-y">
			{#each pending as proposal (proposal.id)}
				<Button
					href={`/assistant/updates/${proposal.id}`}
					variant="ghost"
					class="h-auto w-full justify-between gap-3 py-3 text-left whitespace-normal"
				>
					<span class="min-w-0"
						><span class="block font-medium [overflow-wrap:anywhere]">{proposal.eventTitle}</span
						><span class="block text-xs font-normal text-muted-foreground"
							>{proposal.status === 'pending'
								? 'Add details from your email'
								: proposal.status === 'uncertain'
									? 'Check the update result'
									: 'Updating calendar…'}</span
						></span
					>
					<span class="shrink-0 text-sm">Review</span>
				</Button>
			{/each}
		</div>
	</Section>
{:else if mode === 'updates' && receipts.length}
	<Section title="Calendar outcomes">
		{#each receipts as proposal (proposal.id)}
			<Button
				href={`/assistant/updates/${proposal.id}`}
				variant="ghost"
				class="h-auto w-full justify-start py-3 text-left whitespace-normal"
			>
				<span class="min-w-0"
					><span class="block [overflow-wrap:anywhere]">{proposal.eventTitle}</span><span
						class="block text-xs font-normal text-muted-foreground"
						>{proposal.status === 'completed'
							? 'Details added · View or undo'
							: proposal.status === 'undone'
								? 'Previous notes restored'
								: 'Changed since review · Nothing overwritten'}</span
					></span
				>
			</Button>
		{/each}
	</Section>
{:else if mode === 'watching' && view}
	<Section
		title={view.responsibility.title}
		description="Keep useful details with your upcoming plans, such as door times, seats, and entry instructions."
	>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<p class="text-sm text-muted-foreground">
				{view.responsibility.enabled
					? 'Active · Checked periodically'
					: 'Paused'}{#if view.responsibility.lastReviewAt}
					· Last review ran {new Date(view.responsibility.lastReviewAt).toLocaleString()}{/if}
			</p>
			<Button
				variant="outline"
				disabled={busy}
				onclick={() => onpause(view!.responsibility.enabled)}
				>{view.responsibility.enabled ? 'Pause' : 'Resume'}</Button
			>
		</div>
		<dl class="grid gap-3 text-sm sm:grid-cols-2">
			<div>
				<dt class="text-muted-foreground">Sources</dt>
				<dd>Email and calendar · Fastmail</dd>
			</div>
			<div>
				<dt class="text-muted-foreground">Changes</dt>
				<dd>Suggest additions to event notes. Always ask first.</dd>
			</div>
		</dl>
		<p class="text-sm text-muted-foreground">
			Currently supports existing events without invitees. Calendar upkeep is the first
			responsibility available here.
		</p>
		{#if view.responsibility.lastReadAt}<p class="text-sm text-muted-foreground">
				Last source details verified {new Date(view.responsibility.lastReadAt).toLocaleString()}.
			</p>{:else}<p class="text-sm text-muted-foreground">No source details verified yet.</p>{/if}
		{#if view.responsibility.lastError}<p role="alert" class="text-sm text-destructive">
				{view.responsibility.lastError}
			</p>{/if}
		{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
		<Button href="/connectors" variant="link">Manage connected sources</Button>
	</Section>
	{#if view.proposals.length}
		<Section title="Calendar proposals">
			{#each view.proposals.slice(0, 30) as proposal (proposal.id)}
				<Button
					href={`/assistant/updates/${proposal.id}`}
					variant="ghost"
					class="h-auto w-full justify-between gap-3 py-3 text-left whitespace-normal"
					><span class="min-w-0 [overflow-wrap:anywhere]">{proposal.eventTitle}</span><span
						class="text-xs text-muted-foreground">{proposal.status}</span
					></Button
				>
			{/each}
		</Section>
	{/if}
{/if}
