<script lang="ts">
	import { tick } from 'svelte';
	import { PageIntro } from '$lib/ui/page';
	import * as Field from '$lib/ui/field';
	import { Button } from '$lib/ui/button';
	import * as NativeSelect from '$lib/ui/native-select';
	import { Input } from '$lib/ui/input';
	import { Textarea } from '$lib/ui/textarea';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import Section from '$lib/ui/section/section.svelte';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import type { MailAccount, MailProvider } from './types';
	let {
		accounts,
		providers,
		loaded,
		busy,
		error,
		notice,
		online,
		back,
		onretry,
		onsave,
		onremove
	}: {
		accounts: MailAccount[];
		providers: MailProvider[];
		loaded: boolean;
		busy: boolean;
		error: string | null;
		notice: string | null;
		online: boolean;
		back: { href: string; label: string; desktop?: boolean; onclick?: (e: MouseEvent) => void };
		onretry: () => void;
		onsave: (input: {
			provider: string;
			name: string;
			purpose: string;
			token: string;
			editId?: string;
			reconnectId?: string;
		}) => Promise<boolean>;
		onremove: (id: string) => void;
	} = $props();
	const uid = $props.id();
	let providerId = $state('');
	let name = $state('');
	let purpose = $state('');
	let token = $state('');
	let editId = $state<string | undefined>();
	let reconnectId = $state<string | undefined>();
	let removeId = $state<string | null>(null);
	let editing = $state(false);
	const provider = $derived(providers.find((p) => p.id === providerId) ?? providers[0]);
	const disabled = $derived(busy || !online || !loaded);
	function reset() {
		editing = false;
		editId = undefined;
		reconnectId = undefined;
		name = '';
		purpose = '';
		token = '';
	}
	async function edit(account: MailAccount, reconnect = false) {
		providerId = account.provider;
		name = account.name;
		purpose = account.purpose;
		token = '';
		editId = reconnect ? undefined : account.id;
		reconnectId = reconnect ? account.id : undefined;
		editing = true;
		await tick();
		document.getElementById(`${uid}-name`)?.focus();
	}
	async function save() {
		if (!provider) return;
		const secret = token;
		token = '';
		if (await onsave({ provider: provider.id, name, purpose, token: secret, editId, reconnectId }))
			reset();
	}
</script>

{#snippet banner()}{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}{/snippet}
<DetailScreen title="Mail accounts" {back} {banner}>
	<ScreenContent>
		<div class="flex flex-col gap-8">
			<PageIntro description="Read mail and save drafts. You review and send in your mail app.">
				{#snippet actions()}
					{#if !editing}<Button
							{disabled}
							onclick={async () => {
								reset();
								editing = true;
								await tick();
								document.getElementById(`${uid}-provider`)?.focus();
							}}>Add account</Button
						>{/if}
				{/snippet}
			</PageIntro>
			{#if error}<div role="alert" class="flex flex-wrap items-center gap-3">
					<p class="text-sm text-failed">{error}</p>
					{#if !loaded}<Button variant="outline" disabled={busy || !online} onclick={onretry}
							>Retry</Button
						>{/if}
				</div>{/if}
			{#if notice}<p role="status" class="text-sm">{notice}</p>{/if}
			{#if !loaded && busy}<p role="status" class="text-sm text-muted-foreground">
					Loading accounts…
				</p>{/if}
			{#if loaded}
				{#if !editing}
					<Section id={`${uid}-accounts`} title="Connected accounts" tone="list">
						{#if accounts.length === 0}<p class="py-3 text-sm text-muted-foreground">
								No mail accounts connected yet.
							</p>{/if}
						<ul class="divide-y">
							{#each accounts as account (account.id)}
								<li class="flex flex-col gap-3 py-4">
									<div class="flex min-w-0 flex-col gap-1">
										<h3 class="text-sm font-medium [overflow-wrap:anywhere]">{account.name}</h3>
										<p class="text-sm [overflow-wrap:anywhere] text-muted-foreground">
											{account.email} · {providers.find((p) => p.id === account.provider)?.name ??
												account.provider}
										</p>
										{#if account.purpose}<p class="text-sm [overflow-wrap:anywhere]">
												{account.purpose}
											</p>{/if}
									</div>
									{#if account.problem}<p class="text-sm text-failed">{account.problem}</p>{/if}
									{#if removeId === account.id}
										<p class="text-sm">
											Disconnect {account.name}? Saved drafts stay in your mailbox.
										</p>
										<div class="flex flex-wrap gap-2">
											<Button
												{disabled}
												onclick={() => {
													onremove(account.id);
													removeId = null;
												}}>Disconnect account</Button
											><Button variant="ghost" disabled={busy} onclick={() => (removeId = null)}
												>Cancel</Button
											>
										</div>
									{:else}
										<div class="flex flex-wrap gap-2">
											<Button variant="outline" {disabled} onclick={() => edit(account)}
												>Edit details</Button
											><Button variant="ghost" {disabled} onclick={() => edit(account, true)}
												>Reconnect</Button
											><Button variant="ghost" {disabled} onclick={() => (removeId = account.id)}
												>Disconnect</Button
											>
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					</Section>
				{:else}
					<Section
						id={`${uid}-add`}
						title={editId ? 'Edit account' : reconnectId ? 'Reconnect account' : 'Add mail account'}
					>
						<form
							class="flex flex-col gap-3 pt-3"
							onsubmit={(event) => {
								event.preventDefault();
								void save();
							}}
						>
							<Field.Field
								><Field.Label for={`${uid}-provider`}>Provider</Field.Label>
								<NativeSelect.Root
									id={`${uid}-provider`}
									class="w-full"
									value={provider?.id}
									disabled={disabled || !!editId || !!reconnectId}
									onchange={(e) => {
										providerId = e.currentTarget.value;
										token = '';
									}}
								>
									{#each providers as p (p.id)}<NativeSelect.Option value={p.id}
											>{p.name}</NativeSelect.Option
										>{/each}
								</NativeSelect.Root></Field.Field
							>
							<Field.Field
								><Field.Label for={`${uid}-name`}>Account name</Field.Label><Input
									id={`${uid}-name`}
									bind:value={name}
									placeholder="Oak Street property"
									maxlength={100}
									required
									{disabled}
								/></Field.Field
							>
							<Field.Field
								><Field.Label for={`${uid}-purpose`}>Purpose (optional)</Field.Label><Textarea
									id={`${uid}-purpose`}
									bind:value={purpose}
									placeholder="Maintenance requests and tenant correspondence for Oak Street."
									maxlength={500}
									{disabled}
								/></Field.Field
							>
							{#if !editId && provider?.auth === 'token'}
								<Field.Field
									><Field.Label for={`${uid}-token`}>API token</Field.Label><Input
										id={`${uid}-token`}
										bind:value={token}
										type="password"
										autocomplete="off"
										required
										{disabled}
										aria-describedby={`${uid}-token-help`}
									/>
									<p id={`${uid}-token-help`} class="text-sm text-muted-foreground">
										{provider.setupHelp ??
											'Create an API token with the required mail permissions. The token stays on the gateway.'}
									</p></Field.Field
								>
							{:else if !editId && provider?.auth === 'oauth'}
								<p class="text-sm text-muted-foreground">
									{provider.setupHelp ?? 'Sign in with your provider to connect this account.'}
								</p>
							{/if}
							{#if !editId && provider && !provider.configured}<p class="text-sm text-waiting">
									{provider.name} sign-in needs a one-time gateway setup. See the mail integration setup
									guide.
								</p>{/if}
							<div class="flex flex-wrap gap-2 pt-2">
								<Button
									type="submit"
									disabled={disabled ||
										!provider ||
										(!editId && !provider.configured) ||
										!name.trim()}
									>{busy
										? 'Saving…'
										: editId
											? 'Save details'
											: provider?.auth === 'oauth'
												? (provider.connectLabel ?? `Continue with ${provider.name}`)
												: 'Connect account'}</Button
								><Button variant="ghost" disabled={busy} onclick={reset}>Cancel</Button>
							</div>
						</form>
					</Section>
				{/if}
			{/if}
		</div>
	</ScreenContent>
</DetailScreen>
