<script lang="ts" module>
	export type ThemeChoice = 'system' | 'light' | 'dark';
	export type PushState = 'checking' | 'unsupported' | 'blocked' | 'unavailable' | 'off' | 'on';
</script>

<script lang="ts">
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import BellRing from '@lucide/svelte/icons/bell-ring';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import { Button } from '$lib/ui/button';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	import UpdateToast from '$lib/ui/pwa/update-toast.svelte';
	import * as RadioGroup from '$lib/ui/radio-group';
	import ManagementContent from '$lib/ui/screen/management-content.svelte';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenState, { type RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import { SwitchRow } from '$lib/ui/switch';
	import { cn } from '$lib/utils';
	import OwnerNameField from './components/owner-name-field.svelte';

	let {
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

	const pushLabel = $derived(
		{
			checking: 'Checking…',
			unsupported: "This browser can't receive notifications",
			blocked: 'Blocked in Android settings',
			unavailable: 'Not available right now',
			off: 'Off for this device',
			on: 'On for this device'
		}[push]
	);
	const pushToggleDisabled = $derived(
		pushBusy || push === 'checking' || push === 'unsupported' || push === 'blocked'
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
		<LoaderCircle class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
		Loading your account…
	</p>
{/snippet}

<DetailScreen title="Settings" {back} {banner} toast={updateReady ? toast : undefined}>
	<ManagementContent>
		<div class="flex max-w-3xl flex-col gap-6">
			<section aria-labelledby="account" class="flex flex-col gap-1">
				<h2 id="account" class="text-sm font-semibold">Account</h2>
				<div class="py-3">
					<ScreenState
						compact
						remote={me}
						errorTitle="Couldn't load your account."
						onretry={onretryme}
						skeleton={accountLoading}
					>
						{#if me.data}
							<div class="flex items-start justify-between gap-6 text-sm">
								<p class="shrink-0 text-muted-foreground">Signed in as</p>
								<div class="min-w-0 text-right">
									<p class="font-medium [overflow-wrap:anywhere]" data-testid="login">
										{me.data.displayName ?? me.data.login}
									</p>
									{#if me.data.displayName}
										<p class="text-xs [overflow-wrap:anywhere] text-muted-foreground">
											{me.data.login}
										</p>
									{/if}
								</div>
							</div>
						{/if}
					</ScreenState>
				</div>

				{#if ownerName}
					<div class="border-t">
						<OwnerNameField
							remote={ownerName}
							save={nameSave}
							error={nameError}
							onsave={onsavename}
							onretry={onretryname}
						/>
					</div>
				{/if}
			</section>

			<section aria-labelledby="appearance" class="flex flex-col gap-1">
				<h2 id="appearance" class="text-sm font-semibold">Appearance</h2>
				<div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-1">
					<p class="text-sm text-muted-foreground">Theme</p>
					<RadioGroup.Root
						aria-labelledby="appearance"
						orientation="horizontal"
						onkeydowncapture={themeKeydown}
						class="relative isolate flex w-auto gap-0 before:absolute before:inset-x-0 before:inset-y-2 before:-z-10 before:rounded-lg before:bg-muted"
						bind:value={() => theme, (v) => onchoosetheme?.(v as ThemeChoice)}
					>
						{#each themes as t (t.id)}
							<RadioGroup.Card
								value={t.id}
								compact
								class="px-0.5 [&>span]:h-7 [&>span]:min-w-16 [&>span]:rounded-md [&>span]:border-0 [&>span]:bg-transparent [&>span]:px-3 data-checked:[&>span]:bg-background data-checked:[&>span]:shadow-sm"
								>{t.label}</RadioGroup.Card
							>
						{/each}
					</RadioGroup.Root>
				</div>
			</section>

			<section aria-labelledby="notifications" class="flex flex-col gap-1">
				<h2 id="notifications" class="text-sm font-semibold">Notifications</h2>
				<div class="flex flex-col">
					<SwitchRow
						compact
						checked={push === 'on'}
						disabled={pushToggleDisabled}
						describedby="push-state"
						onchange={() => ontogglepush?.()}
						class="px-0"
					>
						<span class="text-sm font-medium">Notify this device</span>
						<span id="push-state" class="text-sm text-muted-foreground">
							{#if pushBusy}
								{push === 'on' ? 'Turning off…' : 'Turning on…'}
							{:else}
								{pushLabel}
							{/if}
						</span>
					</SwitchRow>
					<div class="flex flex-col items-start gap-2 pb-1">
						<p class="max-w-prose text-sm text-muted-foreground">
							Only when the agent needs you, a run fails, or something you asked about finishes.
						</p>
						<Button
							variant="outline"
							size="compact"
							disabled={push !== 'on' || testBusy}
							onclick={() => ontest?.()}
						>
							{#if testBusy}
								<LoaderCircle class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
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
				</div>
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
			</section>

			<section aria-labelledby="app" class="flex flex-col gap-1">
				<h2 id="app" class="text-sm font-semibold">App</h2>
				<dl class="flex flex-col text-sm">
					<div class="flex min-h-10 items-center justify-between gap-4 py-2">
						<dt class="text-muted-foreground">Version</dt>
						<dd class="font-mono text-xs [overflow-wrap:anywhere]" data-testid="version">
							{version}
						</dd>
					</div>
					<div class="flex min-h-10 items-center justify-between gap-4 py-2">
						<dt class="text-muted-foreground">Installed</dt>
						<dd class="text-right">{standalone ? 'Yes' : 'No, running in the browser'}</dd>
					</div>
				</dl>
				<div class="flex flex-wrap gap-2">
					<Button variant="outline" size="compact" onclick={() => onreload?.()}>
						<RotateCw aria-hidden="true" />Reload app
					</Button>
					{#if canInstall}
						<Button size="compact" onclick={() => oninstall?.()}>Install the app</Button>
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
			</section>
		</div>
	</ManagementContent>
</DetailScreen>
