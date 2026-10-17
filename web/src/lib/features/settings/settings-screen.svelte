<script lang="ts" module>
	export type ThemeChoice = 'system' | 'light' | 'dark';
	export type PushState =
		'checking' | 'unsupported' | 'native-unconfigured' | 'blocked' | 'unavailable' | 'off' | 'on';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import * as Item from '$lib/ui/item';
	import BellRing from '@lucide/svelte/icons/bell-ring';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import { Button } from '$lib/ui/button';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import * as Field from '$lib/ui/field';
	import UpdateToast from '$lib/ui/pwa/update-toast.svelte';
	import * as RadioGroup from '$lib/ui/radio-group';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import Section from '$lib/ui/section/section.svelte';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenState, { type RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import { Spinner } from '$lib/ui/spinner';
	import { Switch } from '$lib/ui/switch';
	import { cn } from '$lib/utils';
	import OwnerNameField from './components/owner-name-field.svelte';

	let {
		accessLinks = [],
		nativeSettings,
		back,
		me,
		ownerName,
		nameSave = 'idle',
		nameError = null,
		push,
		pushBusy = false,
		pushError = null,
		pushSyncFailed = false,
		testBusy = false,
		testResult = null,
		theme,
		version,
		standalone = false,
		canInstall = false,
		installFailed = false,
		swError = null,
		online = true,
		updateReady = false,
		onretryme,
		onretryname,
		onsavename,
		ontogglepush,
		ontest,
		onchoosetheme,
		oninstall,
		onreload
	}: {
		accessLinks?: { label: string; description: string; href: string }[];
		nativeSettings?: Snippet;
		back?: { href: string; label: string; onclick?: (e: MouseEvent) => void };
		me: RemoteLike & { data?: { login: string; displayName?: string } };
		/** What the agent calls you; absent in screens that don't show it. */
		ownerName?: RemoteLike & { data?: { name: string | null } };
		nameSave?: 'idle' | 'saving' | 'saved' | 'failed';
		nameError?: string | null;
		push: PushState;
		pushBusy?: boolean;
		pushError?: string | null;
		/** Notifications are on here, but the agent hasn't got this device's subscription. */
		pushSyncFailed?: boolean;
		testBusy?: boolean;
		testResult?: { ok: boolean; text: string } | null;
		theme: ThemeChoice;
		version: string;
		standalone?: boolean;
		canInstall?: boolean;
		installFailed?: boolean;
		swError?: string | null;
		online?: boolean;
		updateReady?: boolean;
		onretryme?: () => void;
		onretryname?: () => void;
		onsavename?: (name: string | null) => void;
		ontogglepush?: () => void;
		ontest?: () => void;
		onchoosetheme?: (choice: ThemeChoice) => void;
		oninstall?: () => void;
		onreload?: () => void;
	} = $props();
	const uid = $props.id();

	const pushLabel = $derived(
		{
			checking: 'Checking…',
			unsupported: "This browser can't receive notifications",
			'native-unconfigured': 'Not set up in the Android app',
			blocked: 'Blocked in Android settings',
			unavailable: 'Not available right now',
			off: 'Off for this device',
			on: 'On for this device'
		}[push]
	);
	const pushToggleDisabled = $derived(
		pushBusy ||
			push === 'checking' ||
			push === 'unsupported' ||
			push === 'native-unconfigured' ||
			push === 'blocked'
	);
	// The group runs left to right; Up and Down move it too, as in the WAI-ARIA radio pattern.
	// Caught on capture, because the items handle and swallow arrow keys themselves.
	function themeKeydown(e: KeyboardEvent) {
		const step = ({ ArrowDown: 1, ArrowUp: -1 } as Record<string, number>)[e.key];
		if (!step) return;
		e.preventDefault();
		const i = themes.findIndex((t) => t.id === theme);
		const next = (i + step + themes.length) % themes.length;
		onchoosetheme?.(themes[next].id);
		(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
	}

	const themes: { id: ThemeChoice; label: string }[] = [
		{ id: 'system', label: 'System' },
		{ id: 'light', label: 'Light' },
		{ id: 'dark', label: 'Dark' }
	];
</script>

{#snippet banner()}
	{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}
{/snippet}
{#snippet toast()}<UpdateToast onreload={() => onreload?.()} />{/snippet}

{#snippet accountLoading()}
	<p class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
		<Spinner decorative />
		Loading your account…
	</p>
{/snippet}

<DetailScreen title="Settings" {back} {banner} toast={updateReady ? toast : undefined}>
	<ScreenContent>
		<div class="flex flex-col gap-8 md:gap-10">
			{#if accessLinks.length}
				<Section id="agent-access" title="Agent access" tone="list">
					<Item.Group>
						{#each accessLinks as link (link.href)}
							<div role="listitem">
								<Item.Root size="sm">
									{#snippet child({ props })}
										<a href={link.href} {...props}>
											<Item.Content
												><Item.Title>{link.label}</Item.Title><Item.Description
													>{link.description}</Item.Description
												></Item.Content
											>
											<Item.Actions
												><ChevronRight
													class="size-4 text-muted-foreground"
													aria-hidden="true"
												/></Item.Actions
											>
										</a>
									{/snippet}
								</Item.Root>
							</div>
						{/each}
					</Item.Group>
				</Section>
			{/if}
			<Section id="account" title="Account">
				<Field.Group>
					<ScreenState
						remote={me}
						errorTitle="Couldn't load your account."
						onretry={onretryme}
						skeleton={accountLoading}
					>
						{#if me.data}
							<Field.Field orientation="horizontal">
								<Field.Content>
									<Field.Title>Signed in as</Field.Title>
								</Field.Content>
								<div class="min-w-0 text-right text-sm">
									<p class="font-medium [overflow-wrap:anywhere]" data-testid="login">
										{me.data.displayName ?? me.data.login}
									</p>
									{#if me.data.displayName}
										<p class="text-xs [overflow-wrap:anywhere] text-muted-foreground">
											{me.data.login}
										</p>
									{/if}
								</div>
							</Field.Field>
						{/if}
					</ScreenState>

					{#if ownerName}
						<Field.Separator />
						<OwnerNameField
							remote={ownerName}
							save={nameSave}
							error={nameError}
							onsave={onsavename}
							onretry={onretryname}
						/>
					{/if}
				</Field.Group>
			</Section>

			{@render nativeSettings?.()}

			<Section id="appearance" title="Appearance">
				<RadioGroup.Root
					aria-labelledby="appearance"
					orientation="horizontal"
					onkeydowncapture={themeKeydown}
					class="grid-cols-3"
					bind:value={() => theme, (v) => onchoosetheme?.(v as ThemeChoice)}
				>
					{#each themes as t (t.id)}
						<Field.Label for="{uid}-theme-{t.id}">
							<Field.Field orientation="horizontal">
								<RadioGroup.Item value={t.id} id="{uid}-theme-{t.id}" />
								<Field.Title>{t.label}</Field.Title>
							</Field.Field>
						</Field.Label>
					{/each}
				</RadioGroup.Root>
			</Section>

			<Section id="notifications" title="Notifications">
				<Field.Group>
					<Field.Field orientation="horizontal" data-disabled={pushToggleDisabled || undefined}>
						<Field.Content>
							<Field.Label for="{uid}-push">Notify this device</Field.Label>
							<Field.Description id="{uid}-push-state">
								{#if pushBusy}
									{push === 'on' ? 'Turning off…' : 'Turning on…'}
								{:else}
									{pushLabel}
								{/if}
							</Field.Description>
						</Field.Content>
						<Switch
							id="{uid}-push"
							bind:checked={() => push === 'on', () => ontogglepush?.()}
							disabled={pushToggleDisabled}
							aria-describedby="{uid}-push-state {uid}-push-help"
						/>
					</Field.Field>
					<div class="flex flex-col items-start gap-2">
						<Field.Description id="{uid}-push-help">
							{#if push === 'native-unconfigured'}Use the browser app for notifications until native
								Android push is configured.{:else}Only when the agent needs you, a run fails, or
								something you asked about finishes.{/if}
						</Field.Description>
						<Button
							variant="outline"
							disabled={push !== 'on' || testBusy}
							onclick={() => ontest?.()}
						>
							{#if testBusy}
								<Spinner decorative />
								Sending…
							{:else}
								<BellRing aria-hidden="true" />Send test notification
							{/if}
						</Button>
						{#if testResult}
							<p
								role={testResult.ok ? 'status' : 'alert'}
								class={cn('text-sm', !testResult.ok && 'text-failed')}
							>
								{testResult.text}
							</p>
						{/if}
					</div>
				</Field.Group>
				{#if pushError}
					<p role="alert" class="text-sm text-failed">{pushError}</p>
				{:else if push === 'on' && pushSyncFailed}
					<p role="status" class="text-sm text-muted-foreground">
						Couldn't sync this device with the agent. The app will retry when you come back to it.
					</p>
				{/if}
				{#if push === 'blocked'}
					<div class="flex flex-col gap-2 rounded-xl bg-waiting-soft px-4 py-3 text-sm">
						<p class="font-medium">Turn notifications back on</p>
						<ol class="flex list-decimal flex-col gap-1 pl-5">
							<li>Long-press the sushii icon on your home screen and tap App info.</li>
							<li>Tap Notifications and switch them on.</li>
							<li>Come back here and turn notifications on.</li>
						</ol>
						<p class="text-muted-foreground">
							In a Chrome tab instead: tap the icon left of the address, then Permissions, then
							Notifications.
						</p>
					</div>
				{/if}
			</Section>

			<Section id="app" title="App">
				<dl class="flex flex-col gap-2 text-sm">
					<div class="flex items-center justify-between gap-4">
						<dt class="text-muted-foreground">Version</dt>
						<dd class="font-mono text-xs [overflow-wrap:anywhere]" data-testid="version">
							{version}
						</dd>
					</div>
					<div class="flex items-center justify-between gap-4">
						<dt class="text-muted-foreground">Installed</dt>
						<dd class="text-right">{standalone ? 'Yes' : 'No, running in the browser'}</dd>
					</div>
				</dl>
				<div class="flex flex-wrap gap-2">
					<Button variant="outline" onclick={() => onreload?.()}>
						<RotateCw aria-hidden="true" />Reload app
					</Button>
					{#if canInstall}
						<Button onclick={() => oninstall?.()}>Install the app</Button>
					{/if}
				</div>
				{#if installFailed}
					<p role="alert" class="text-sm text-failed">
						Chrome didn't open the install prompt. Open Chrome's menu and choose Install app.
					</p>
				{/if}
				{#if swError}
					<p role="alert" class="text-sm text-failed">
						Offline support is off: the background worker didn't start ({swError}).
					</p>
				{/if}
			</Section>
		</div>
	</ScreenContent>
</DetailScreen>
