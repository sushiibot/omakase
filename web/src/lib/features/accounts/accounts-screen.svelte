<script lang="ts">
	import { Button } from '$lib/ui/button';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import Section from '$lib/ui/section/section.svelte';
	import * as Collapsible from '$lib/ui/collapsible';
	import DisclosureTrigger from '$lib/ui/collapsible/disclosure-trigger.svelte';
	import { dayLabel, clock } from '$lib/ui/format/time';
	import type { Account, AuditEvent } from './types';
	let {
		accounts,
		loading,
		busy,
		error,
		notice,
		secret,
		online,
		historyId,
		events,
		historyLoading,
		historyError,
		onrefresh,
		onreveal,
		onhide,
		onarchive,
		onhistory
	}: {
		accounts: Account[];
		loading: boolean;
		busy: boolean;
		error: string | null;
		notice: string | null;
		secret: { id: string; password: string; version: number } | null;
		online: boolean;
		historyId: string | null;
		events: AuditEvent[];
		historyLoading: boolean;
		historyError: boolean;
		onrefresh: () => void;
		onreveal: (a: Account, purpose: 'reveal' | 'copy', version?: number) => void;
		onhide: () => void;
		onarchive: (a: Account) => void;
		onhistory: (id: string | null) => void;
	} = $props();
	let archiveId = $state<string | null>(null);
	const now = Date.now();
	const labels: Record<string, string> = {
		prepare: 'Password prepared',
		revise: 'Password revised',
		confirm: 'Password confirmed',
		archive: 'Account archived',
		reveal: 'Password revealed',
		copy: 'Password copied',
		fill: 'Browser fill requested',
		fill_result: 'Browser fill result'
	};
</script>

<DetailScreen title="Accounts" back={{ href: '/settings', label: 'Settings', desktop: false }}>
	<ScreenContent>
		<div class="flex flex-col gap-6">
			<p class="text-sm text-muted-foreground">
				Ask the agent in chat to create an account on a website. It generates and saves the password
				here, then fills the website form. Review the form before submitting it. Ask the agent to
				confirm the password once the website accepts it.
			</p>
			<div class="flex flex-wrap gap-2">
				<Button href="/chat">Open chat</Button>
				<Button variant="outline" onclick={onrefresh} disabled={loading || busy || !online}
					>Refresh accounts</Button
				>
			</div>
			{#if !online}<p role="status" class="text-sm text-muted-foreground">
					You’re offline. Connect to view or manage passwords.
				</p>{/if}
			{#if error}<p role="alert" class="text-sm text-failed">{error}</p>{/if}
			{#if notice}<p role="status" class="text-sm">{notice}</p>{/if}
			{#if loading}<p role="status" class="text-sm text-muted-foreground">Loading accounts…</p>
			{:else if !accounts.length && !error}
				<Section
					title="No accounts yet"
					description="Accounts created by the agent will appear here. You can reveal passwords, copy them, and review their history."
					><span></span></Section
				>
			{/if}
			{#each accounts as account (account.id)}
				<Section
					title={account.name}
					class="[&_h2]:min-w-0 [&_h2_span]:min-w-0 [&_h2_span]:break-all"
				>
					<div class="flex min-w-0 flex-col gap-3 border-b pb-6">
						<p class="text-sm break-all">{account.origin}</p>
						<p class="text-sm break-all">
							<span class="text-muted-foreground">Username:</span>
							{account.username}
						</p>
						<p class="text-sm text-muted-foreground">
							{account.status === 'archived'
								? 'Archived'
								: account.status === 'active'
									? 'Active'
									: 'Pending confirmation'} · Version {account.version}
							{#if account.confirmedVersion !== undefined && account.confirmedVersion !== account.version}
								· Last confirmed: version {account.confirmedVersion}{/if}
						</p>
						{#if account.confirmedVersion !== account.version}<p
								class="text-sm text-muted-foreground"
							>
								The latest password has not been confirmed as accepted by the website.
							</p>{/if}
						<div class="flex flex-wrap gap-2">
							{#if secret?.id === account.id}<Button variant="outline" onclick={onhide}
									>Hide password</Button
								>
							{:else}<Button
									variant="outline"
									disabled={busy || !online}
									onclick={() => onreveal(account, 'reveal')}>Reveal password</Button
								>{/if}
							<Button
								variant="outline"
								disabled={busy || !online}
								onclick={() =>
									onreveal(
										account,
										'copy',
										secret?.id === account.id ? secret.version : account.version
									)}>Copy password</Button
							>
							{#if account.status !== 'archived'}
								<Button
									variant="ghost"
									disabled={busy || !online}
									onclick={() => {
										onhide();
										archiveId = account.id;
									}}>Archive</Button
								>
							{/if}
						</div>
						{#if account.confirmedVersion !== undefined && account.confirmedVersion !== account.version}
							<div>
								<Button
									variant="outline"
									disabled={busy || !online}
									onclick={() => onreveal(account, 'reveal', account.confirmedVersion)}
									>Reveal last confirmed password</Button
								>
							</div>
						{/if}
						{#if secret?.id === account.id}
							<div class="flex min-w-0 flex-col gap-1">
								<p class="text-xs text-muted-foreground">
									Version {secret.version} · Hides after 30 seconds
								</p>
								<p
									aria-label="Revealed password"
									class="rounded-md bg-muted p-3 font-mono text-sm break-all select-all"
								>
									{secret.password}
								</p>
							</div>
						{/if}
						{#if archiveId === account.id && account.status !== 'archived'}
							<div class="flex flex-col items-start gap-2">
								<p class="text-sm">
									Archive this saved account? This stops browser fills. It does not delete your
									account on the website.
								</p>
								<div class="flex flex-wrap gap-2">
									<Button
										variant="destructive"
										disabled={busy || !online}
										onclick={() => {
											archiveId = null;
											onarchive(account);
										}}>Archive account</Button
									>
									<Button variant="outline" onclick={() => (archiveId = null)}>Cancel</Button>
								</div>
							</div>
						{/if}
						<Collapsible.Root
							open={historyId === account.id}
							onOpenChange={(open) => onhistory(open ? account.id : null)}
						>
							<DisclosureTrigger>Account history</DisclosureTrigger>
							<Collapsible.Content>
								<div class="pt-2">
									{#if historyLoading}<p role="status" class="text-sm text-muted-foreground">
											Loading history…
										</p>
									{:else if historyError}<p role="alert" class="text-sm text-failed">
											Could not load account history.
										</p>
										<Button
											variant="outline"
											onclick={() => onhistory(account.id)}
											disabled={!online}>Retry history</Button
										>
									{:else if !events.length}<p class="text-sm text-muted-foreground">
											No history yet.
										</p>
									{:else}<ol class="flex flex-col gap-3">
											{#each [...events].sort((a, b) => b.at - a.at) as event (event.id)}
												<li class="flex flex-col gap-1 text-sm">
													<p>
														{labels[event.action] ??
															event.action.replaceAll('_', ' ')}{event.version !== undefined
															? ` · Version ${event.version}`
															: ''}
													</p>
													<p class="text-xs break-words text-muted-foreground">
														{dayLabel(event.at, now)}, {clock(event.at)} · {event.actor}{event.engine
															? ` · ${event.engine}`
															: ''}{event.outcome ? ` · ${event.outcome}` : ''}
													</p>
												</li>
											{/each}
										</ol>{/if}
								</div>
							</Collapsible.Content>
						</Collapsible.Root>
					</div>
				</Section>
			{/each}
		</div>
	</ScreenContent>
</DetailScreen>
