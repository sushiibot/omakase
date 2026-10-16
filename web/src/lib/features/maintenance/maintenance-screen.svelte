<script lang="ts">
	import { eventTime } from './format';
	import { Button } from '$lib/ui/button';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import Section from '$lib/ui/section/section.svelte';
	import type { RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import type { CalendarProposal, MaintenanceAction } from './types';
	let {
		proposal,
		remote,
		busy,
		error,
		enabled,
		offline,
		onretry,
		onaction
	}: {
		proposal?: CalendarProposal;
		remote: RemoteLike;
		busy: boolean;
		error: string | null;
		enabled: boolean;
		offline: boolean;
		onretry: () => void;
		onaction: (action: MaintenanceAction) => void;
	} = $props();
	const expired = $derived(proposal ? Date.parse(proposal.expiresAt) < Date.now() : false);
	function act(action: 'approve' | 'dismiss' | 'undo' | 'reconcile') {
		if (proposal) onaction({ action, id: proposal.id, revision: proposal.revision });
	}
</script>

<DetailScreen
	title="Calendar update"
	back={{ href: '/assistant', label: 'Home' }}
	hasContent={!!proposal}
	state={{
		remote,
		isEmpty: !proposal && remote.status === 'ready',
		onretry,
		errorTitle: "Couldn't load this update.",
		empty: { title: 'Update not found', body: 'Return to Home to find another update.' }
	}}
>
	{#if proposal}
		<ScreenContent measure="reading">
			<Section
				title={proposal.eventTitle}
				description={eventTime(proposal.eventStart, proposal.eventTimeZone)}
			>
				<p class="text-sm">{proposal.input.reason}</p>
				<p class="text-sm text-muted-foreground">
					Only the event notes change. This update adds details to an existing event without
					invitees.
				</p>
			</Section>
			<Section title="Details to add">
				<div class="space-y-3 rounded-xl border p-4">
					{#each proposal.input.excerpts as excerpt}<p
							class="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap"
						>
							{excerpt}
						</p>{/each}
				</div>
			</Section>
			<Section title="Source email" description={proposal.emailSubject}>
				<p class="text-sm text-muted-foreground">
					Received {new Date(proposal.emailReceivedAt).toLocaleString()}. The details above are
					exact excerpts from this email.
				</p>
			</Section>
			<Section title="Resulting event notes">
				<p class="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">{proposal.after}</p>
			</Section>
			{#if proposal.before}<Section title="Original notes"
					><p class="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap text-muted-foreground">
						{proposal.before}
					</p></Section
				>{/if}
			{#if proposal.message}<p role="status" class="text-sm">{proposal.message}</p>{/if}
			{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
			{#if offline}<p role="status" class="text-sm text-muted-foreground">
					Connect to the internet to update the calendar.
				</p>{/if}
			{#if proposal.status === 'pending'}
				{#if !enabled}<p role="status" class="text-sm text-muted-foreground">
						Calendar maintenance is paused. Resume it in Watching to approve this update.
					</p>{/if}
				{#if expired}<p role="status" class="text-sm text-muted-foreground">
						This proposal has expired. A fresh check is needed.
					</p>{/if}
				<div class="flex flex-wrap gap-2">
					<Button disabled={busy || offline || !enabled || expired} onclick={() => act('approve')}
						>{busy ? 'Checking and updating…' : 'Update event'}</Button
					><Button variant="outline" disabled={busy || offline} onclick={() => act('dismiss')}
						>Dismiss</Button
					>
				</div>
			{:else if proposal.status === 'completed'}
				<Button variant="outline" disabled={busy || offline} onclick={() => act('undo')}
					>{busy ? 'Checking calendar…' : 'Undo update'}</Button
				>
			{:else if proposal.status === 'uncertain'}
				<Button disabled={busy || offline} onclick={() => act('reconcile')}
					>{busy ? 'Checking calendar…' : 'Check result'}</Button
				>
			{:else if ['executing', 'undoing'].includes(proposal.status)}<p role="status" class="text-sm">
					Updating the calendar. You can leave this page and return to check the result.
				</p>
			{:else}<p class="text-sm text-muted-foreground">
					{proposal.status === 'dismissed'
						? 'Dismissed. These same additions will not be suggested again.'
						: proposal.status === 'superseded'
							? 'A newer proposal is available on Home.'
							: proposal.status === 'undone'
								? 'Update undone.'
								: 'This proposal needs a fresh review.'}
				</p>{/if}
		</ScreenContent>
	{/if}
</DetailScreen>
