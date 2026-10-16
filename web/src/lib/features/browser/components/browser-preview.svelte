<script lang="ts">
	import Monitor from '@lucide/svelte/icons/monitor';
	import Maximize from '@lucide/svelte/icons/maximize';
	import X from '@lucide/svelte/icons/x';
	import ZoomIn from '@lucide/svelte/icons/zoom-in';
	import ZoomOut from '@lucide/svelte/icons/zoom-out';
	import { Button } from '$lib/ui/button';
	import * as Sheet from '$lib/ui/sheet';
	import BrowserControls from './browser-controls.svelte';
	import type { BrowserPreviewFrame, BrowserPreviewStatus, BrowserInput } from '../preview-types';

	let {
		status,
		frame,
		hidden,
		expanded,
		reconnecting,
		stale,
		onhide,
		onshow,
		onexpand,
		onclose,
		onframe,
		controlling = false,
		controlError = '',
		oncontrol
	}: {
		status: BrowserPreviewStatus | null;
		frame: BrowserPreviewFrame | null;
		hidden: boolean;
		expanded: boolean;
		reconnecting: boolean;
		stale: boolean;
		onhide: () => void;
		onshow: () => void;
		onexpand: () => void;
		onclose: () => void;
		onframe: (seq: number) => void;
		controlling?: boolean;
		controlError?: string;
		oncontrol?: (action: 'takeover' | 'resume' | 'input', input?: BrowserInput) => Promise<boolean>;
	} = $props();
	let zoomed = $state(false);
	let details = $state(false);
	const ownerControl = $derived(status?.control === 'owner' && status?.state !== 'ended');
	function clickPage(event: MouseEvent) {
		if (!ownerControl || controlling || reconnecting || stale || !frame || event.detail === 0)
			return;
		const image =
			event.currentTarget instanceof HTMLElement ? event.currentTarget.querySelector('img') : null;
		if (!image) return;
		const rect = image.getBoundingClientRect();
		const scale = Math.min(rect.width / frame.width, rect.height / frame.height);
		const x = (event.clientX - rect.left - (rect.width - frame.width * scale) / 2) / scale;
		const y = (event.clientY - rect.top - (rect.height - frame.height * scale) / 2) / scale;
		if (x >= 0 && y >= 0 && x < frame.width && y < frame.height)
			void oncontrol?.('input', { kind: 'click', x, y });
	}
	const hostname = $derived.by(() => {
		try {
			return status?.url ? new URL(status.url).hostname || 'Browser' : 'Browser';
		} catch {
			return 'Browser';
		}
	});
	const label = $derived(
		status?.state === 'ended'
			? 'Finished'
			: reconnecting
				? 'Reconnecting…'
				: stale
					? 'Preview paused'
					: ownerControl
						? 'You have control'
						: frame
							? 'Live'
							: 'Opening browser…'
	);
	const source = $derived(frame ? `data:image/jpeg;base64,${frame.data}` : undefined);
	$effect(() => {
		if (!expanded) zoomed = false;
	});
</script>

{#if status}
	<section aria-label="Browser preview" class="shrink-0 border-b bg-muted/30">
		<div class="flex items-center gap-2 px-3 py-2">
			<Monitor class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			<div class="min-w-0 flex-1">
				<p class="truncate text-sm font-medium">{hostname}</p>
				<p role="status" class="text-xs text-muted-foreground">{label}</p>
			</div>
			{#if hidden}
				{#if status.state !== 'ended'}<Button variant="ghost" onclick={onshow}>Show</Button>{/if}
			{:else}
				<Button
					size="icon"
					variant="ghost"
					aria-label="Expand browser preview"
					disabled={!frame}
					onclick={onexpand}><Maximize aria-hidden="true" /></Button
				>
				<Button size="icon" variant="ghost" aria-label="Hide browser preview" onclick={onhide}
					><X aria-hidden="true" /></Button
				>
			{/if}
		</div>
		{#if frame && !hidden && !expanded}
			<div class="relative bg-muted">
				<img
					src={source}
					alt={`Agent browser at ${hostname}`}
					class="mx-auto max-h-48 w-full object-contain"
					onload={() => onframe(frame!.seq)}
				/>
				{#if reconnecting || stale || status.state === 'ended'}<p
						class="absolute right-2 bottom-2 rounded-md bg-background px-2 py-1 text-xs"
					>
						{label} · last frame
					</p>{/if}
			</div>
			<p class="truncate px-3 py-1 text-xs text-muted-foreground">{status.action}</p>
		{/if}
	</section>
{/if}

<Sheet.Root
	open={expanded}
	onOpenChange={(open) => {
		if (!open) onclose();
	}}
>
	<Sheet.Content
		side="bottom"
		showCloseButton={false}
		class="gap-0 bg-background pt-(--safe-top) pb-(--safe-bottom) text-foreground outline-none data-[side=bottom]:top-0 data-[side=bottom]:bottom-(--kb) data-[side=bottom]:border-t-0"
	>
			<div class="flex h-(--header-height) shrink-0 items-center gap-2 border-b px-3">
				<Sheet.Title class="min-w-0 flex-1 truncate text-sm font-medium"
					>{hostname} · {label}</Sheet.Title
				>
				<Button
					variant="ghost"
					aria-label={zoomed ? 'Fit browser screen' : 'Zoom browser screen'}
					aria-pressed={zoomed}
					onclick={() => (zoomed = !zoomed)}
					>{#if zoomed}<ZoomOut aria-hidden="true" />{:else}<ZoomIn
							aria-hidden="true"
						/>{/if}</Button
				>
				<Button
					variant="ghost"
					class="size-12 px-0"
					aria-label="Close browser screen"
					onclick={onclose}><X aria-hidden="true" /></Button
				>
			</div>
			<Dialog.Description class="sr-only"
				>Watch the browser, or take control to sign in. The agent waits while you have control.</Dialog.Description
			>
			<div
				class="flex min-h-0 flex-1 overflow-auto overscroll-contain bg-muted"
				class:items-center={!zoomed}
				class:items-start={zoomed}
			>
				{#if frame}
					{#if ownerControl}
						<button
							type="button"
							aria-label="Browser page: select a field or button"
							class={zoomed
								? 'shrink-0 self-start outline-offset-2'
								: 'flex h-full w-full items-center justify-center outline-offset-2'}
							onclick={clickPage}
							disabled={controlling || reconnecting || stale}
						>
							<img
								src={source}
								alt={`Browser at ${hostname}`}
								class={zoomed ? 'max-w-none shrink-0' : 'max-h-full w-full object-contain'}
								width={zoomed ? frame.width : undefined}
								height={zoomed ? frame.height : undefined}
								onload={() => onframe(frame!.seq)}
							/>
						</button>
					{:else}
						<img
							src={source}
							alt={`Agent browser at ${hostname}`}
							class={zoomed ? 'max-w-none shrink-0' : 'max-h-full w-full object-contain'}
							width={zoomed ? frame.width : undefined}
							height={zoomed ? frame.height : undefined}
							onload={() => onframe(frame!.seq)}
						/>
					{/if}
				{:else}<p role="status" class="m-auto text-sm text-muted-foreground">
						Waiting for the browser screen…
					</p>{/if}
			</div>
			{#if oncontrol && status?.state === 'active'}
				<BrowserControls
					{status}
					busy={controlling}
					unavailable={reconnecting || stale || !frame}
					error={controlError}
					control={oncontrol}
				/>
			{/if}
			<div class="shrink-0 border-t px-3">
				<div class="flex items-center justify-between gap-2">
					<p class="truncate text-sm">{status?.action ?? 'Browser finished'}</p>
					<Button variant="ghost" aria-expanded={details} onclick={() => (details = !details)}
						>Details</Button
					>
				</div>
				{#if details}<p class="pb-3 text-meta [overflow-wrap:anywhere] text-muted-foreground">
						{status?.url ?? 'No page address'} · {status?.engine === 'camoufox'
							? 'Camoufox'
							: 'Chromium'} · {ownerControl ? 'You have control' : 'Viewing'}
					</p>{/if}
			</div>
	</Sheet.Content>
</Sheet.Root>
