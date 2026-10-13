<script lang="ts">
	import Copy from '@lucide/svelte/icons/copy';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Link2 from '@lucide/svelte/icons/link-2';
	import { Button } from '$lib/ui/button';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import * as Field from '$lib/ui/field';
	import { Input } from '$lib/ui/input';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import ScreenFooter from '$lib/ui/screen/screen-footer.svelte';
	import { Spinner } from '$lib/ui/spinner';
	import { cn } from '$lib/utils';
	import type { AddState } from './types';

	let {
		add,
		back,
		online = true,
		copied = false,
		copyError = null,
		restored = false,
		onstartover,
		onurl,
		ontoken,
		onredirect,
		onbegin,
		onsignedin,
		onfinish,
		onstepback,
		oncopy
	}: {
		add: AddState;
		back: { href: string; label: string; onclick?: (e: MouseEvent) => void };
		online?: boolean;
		copied?: boolean;
		copyError?: string | null;
		restored?: boolean;
		onstartover?: () => void;
		ontoken?: (token: string) => void;
		onurl?: (url: string) => void;
		onredirect?: (redirect: string) => void;
		onbegin?: () => void;
		onsignedin?: () => void;
		onfinish?: () => void;
		onstepback?: () => void;
		oncopy?: (text: string) => void;
	} = $props();
	const uid = $props.id();
	const steps = ['Server address', 'Sign in', 'Paste back'];
	const step = $derived(add.stage === 'url' ? 0 : add.stage === 'oauth' ? 1 : 2);
	const hasCode = $derived(/[?&]code=/.test(add.redirect));
</script>

{#snippet banner()}
	{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}
{/snippet}

{#snippet busySpinner()}
	<Spinner role="presentation" aria-hidden="true" class="motion-reduce:animate-none" />
{/snippet}

{#snippet footer()}
	<ScreenFooter>
		{#if add.error && !add.errorField}<p role="alert" class="text-sm text-failed">
				{add.error}
			</p>{/if}
		<div class="flex flex-wrap items-center gap-2">
			{#if add.stage === 'url'}
				<Button disabled={!add.url.trim() || add.busy || !online} onclick={onbegin}>
					{#if add.busy}{@render busySpinner()}Checking the server…{:else}Continue{/if}
				</Button>
			{:else if add.stage === 'oauth'}
				<Button onclick={onsignedin}>I've signed in</Button>
				<Button variant="ghost" onclick={onstepback}>Back to the address</Button>
			{:else}
				<Button disabled={!hasCode || add.busy || !online} onclick={onfinish}>
					{#if add.busy}{@render busySpinner()}Connecting…{:else}Connect{/if}
				</Button>
				<Button variant="ghost" onclick={onstepback}>Back to sign-in</Button>
			{/if}
		</div>
	</ScreenFooter>
{/snippet}

<DetailScreen title="Add a server" {back} {banner} {footer}>
	<ScreenContent>
		<ol class="grid grid-cols-3 gap-2 text-xs" aria-label="Steps">
			{#each steps as label, i (label)}
				<li
					aria-current={i === step ? 'step' : undefined}
					class={cn('flex flex-col gap-1.5', i > step ? 'text-muted-foreground' : 'font-medium')}
				>
					<span class={cn('h-1 rounded-full', i <= step ? 'bg-foreground' : 'bg-muted')}></span>
					{label}
				</li>
			{/each}
		</ol>

		{#if restored}
			<div class="flex flex-col items-start gap-2">
				<p role="status" class="text-sm text-muted-foreground">
					Resumed your server setup. Tokens and callback addresses were cleared when you left; enter
					them again if needed.
				</p>
				<Button variant="ghost" disabled={add.busy} onclick={onstartover}>Start over</Button>
			</div>
		{/if}
		{#if add.stage === 'url'}
			<Field.Group>
				<Field.Field>
					<Field.Label for="{uid}-url">Server address</Field.Label>
					<Input
						id="{uid}-url"
						aria-invalid={add.errorField === 'url' || undefined}
						aria-describedby={`${uid}-url-help${add.errorField === 'url' ? ` ${uid}-url-error` : ''}`}
						value={add.url}
						oninput={(e) => onurl?.(e.currentTarget.value)}
						placeholder="https://example.com/mcp"
						inputmode="url"
						autocomplete="off"
						autocapitalize="off"
						spellcheck={false}
						class="font-mono"
					/>
					<Field.Description id="{uid}-url-help">
						An https:// address for a Streamable HTTP MCP server. Leave the token blank to sign in
						with OAuth.
					</Field.Description>
					{#if add.errorField === 'url'}<p
							id="{uid}-url-error"
							role="alert"
							class="text-sm text-failed"
						>
							{add.error}
						</p>{/if}
				</Field.Field>
				<Field.Field>
					<Field.Label for="{uid}-token">API token (optional)</Field.Label>
					<Input
						id="{uid}-token"
						aria-describedby="{uid}-token-help"
						type="password"
						value={add.token ?? ''}
						oninput={(e) => ontoken?.(e.currentTarget.value)}
						autocomplete="off"
						spellcheck={false}
					/>
					<Field.Description id="{uid}-token-help">
						For Fastmail, use https://api.fastmail.com/mcp and create an MCP token with only “Read
						data” enabled. The token is stored on the workspace server.
					</Field.Description>
				</Field.Field>
			</Field.Group>
		{:else if add.stage === 'oauth'}
			<section class="flex flex-col gap-3">
				<p class="text-sm">
					<span class="font-medium">{add.name}</span> uses a sign-in. Open this link on any device and
					approve.
				</p>
				<div class="flex items-start gap-2 rounded-md border bg-muted/50 p-3">
					<Link2 class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<code class="min-w-0 flex-1 font-mono text-xs break-all select-text">{add.authUrl}</code>
				</div>
				<div class="flex flex-wrap gap-2">
					<Button variant="outline" href={add.authUrl} target="_blank" rel="noopener noreferrer"
						><ExternalLink />Open sign-in link</Button
					>
					<Button variant="outline" onclick={() => add.authUrl && oncopy?.(add.authUrl)}
						><Copy />{copied ? 'Copied' : 'Copy'}</Button
					>
				</div>
				{#if copyError}<p role="alert" class="text-sm text-failed">{copyError}</p>{/if}
				<p class="text-sm text-muted-foreground">
					After you approve, the browser lands on a localhost page that won't load. That's expected:
					the agent runs on a server, not on this phone. Copy that page's whole address.
				</p>
			</section>
		{:else}
			<Field.Field>
				<Field.Label for="{uid}-redirect">Address from the browser</Field.Label>
				<Input
					id="{uid}-redirect"
					aria-invalid={(!!add.redirect && !hasCode) || undefined}
					aria-describedby={`${uid}-redirect-help${add.redirect && !hasCode ? ` ${uid}-redirect-error` : ''}`}
					value={add.redirect}
					oninput={(e) => onredirect?.(e.currentTarget.value)}
					placeholder="http://localhost:7461/callback?code=…"
					autocomplete="off"
					autocapitalize="off"
					spellcheck={false}
					class="font-mono"
				/>
				<Field.Description id="{uid}-redirect-help">
					Copy the whole localhost callback address, including its code and state.
				</Field.Description>
				{#if add.redirect && !hasCode}
					<p id="{uid}-redirect-error" role="alert" class="text-sm text-failed">
						That address has no code. Copy it again after approving.
					</p>
				{/if}
			</Field.Field>
		{/if}
	</ScreenContent>
</DetailScreen>
