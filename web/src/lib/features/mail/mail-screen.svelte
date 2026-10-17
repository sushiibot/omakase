<script lang="ts">
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
		rules,
		loaded,
		busy,
		error,
		notice,
		online,
		back,
		onretry,
		onsave,
		onremove,
		onsaverules
	}: {
		accounts: MailAccount[];
		providers: MailProvider[];
		rules: string;
		loaded: boolean;
		busy: boolean;
		error: string | null;
		notice: string | null;
		online: boolean;
		back: { href: string; label: string; onclick?: (e: MouseEvent) => void };
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
		onsaverules: (rules: string) => void;
	} = $props();
	const uid = $props.id();
	let providerId = $state('');
	let name = $state('');
	let purpose = $state('');
	let token = $state('');
	let editId = $state<string | undefined>();
	let reconnectId = $state<string | undefined>();
	let removeId = $state<string | null>(null);
	let customRules = $state<string | undefined>();
	const provider = $derived(providers.find((p) => p.id === providerId) ?? providers[0]);
	const disabled = $derived(busy || !online || !loaded);
	function reset() {
		editId = undefined;
		reconnectId = undefined;
		name = '';
		purpose = '';
		token = '';
	}
	function edit(account: MailAccount, reconnect = false) {
		providerId = account.provider;
		name = account.name;
		purpose = account.purpose;
		token = '';
		editId = reconnect ? undefined : account.id;
		reconnectId = reconnect ? account.id : undefined;
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
<DetailScreen title="Accounts & rules" {back} {banner}>
	<ScreenContent>
		<div class="flex flex-col gap-8">
			<p class="text-sm text-muted-foreground">
				Connect mail accounts for the agent to read and prepare drafts. You review and send in your
				mail app.
			</p>
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
				<Section id={`${uid}-accounts`} title="Mail accounts" tone="list">
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
				<Section
					id={`${uid}-add`}
					title={editId ? 'Edit account' : reconnectId ? 'Reconnect account' : 'Add mail account'}
					tone="list"
				>
					<form
						class="flex flex-col gap-3 pt-3"
						onsubmit={(event) => {
							event.preventDefault();
							void save();
						}}
					>
						<label for={`${uid}-provider`} class="text-sm font-medium">Provider</label>
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
						</NativeSelect.Root>
						<label for={`${uid}-name`} class="text-sm font-medium">Account name</label><Input
							id={`${uid}-name`}
							bind:value={name}
							placeholder="Oak Street property"
							maxlength={100}
							required
							{disabled}
						/>
						<label for={`${uid}-purpose`} class="text-sm font-medium">Purpose (optional)</label
						><Textarea
							id={`${uid}-purpose`}
							bind:value={purpose}
							placeholder="Maintenance requests and tenant correspondence for Oak Street."
							maxlength={500}
							{disabled}
						/>
						{#if !editId && provider?.auth === 'token'}
							<label for={`${uid}-token`} class="text-sm font-medium">API token</label><Input
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
							</p>
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
							>{#if editId || reconnectId}<Button variant="ghost" disabled={busy} onclick={reset}
									>Cancel</Button
								>{/if}
						</div>
					</form>
				</Section>
				<Section id={`${uid}-policy`} title="Tool-use rules" tone="list">
					<form
						class="flex flex-col gap-3 pt-3"
						onsubmit={(event) => {
							event.preventDefault();
							onsaverules(customRules ?? rules);
						}}
					>
						<p class="text-sm text-muted-foreground">
							The decision model reviews MCP calls and draft saves. Actions that notify other people
							require your approval. Mail accounts connected here cannot send.
						</p>
						<label for={`${uid}-rules`} class="text-sm font-medium">Additional restrictions</label>
						<Textarea
							id={`${uid}-rules`}
							value={customRules ?? rules}
							oninput={(e) => (customRules = e.currentTarget.value)}
							rows={5}
							maxlength={4000}
							{disabled}
							placeholder="Use property accounts for drafts only. Do not change calendar events or notify attendees."
						/>
						<div class="flex flex-wrap gap-2">
							<Button
								variant="outline"
								{disabled}
								onclick={() =>
									(customRules =
										'Use connected services read-only. Do not create, update, delete, send, or notify.')}
								>Read-only preset</Button
							><Button
								variant="outline"
								{disabled}
								onclick={() =>
									(customRules =
										'Read connected services and save private drafts only. Do not send, publish, share, invite, or notify other people.')}
								>Draft-only preset</Button
							>
						</div>
						<p class="text-sm text-muted-foreground">
							These rules guide the reviewer. For a provider-enforced limit on MCP tools, also
							restrict permissions at the provider.
						</p>
						<div><Button type="submit" {disabled}>Save rules</Button></div>
					</form>
				</Section>
			{/if}
		</div>
	</ScreenContent>
</DetailScreen>
