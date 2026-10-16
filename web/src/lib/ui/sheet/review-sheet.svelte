<!-- app: nonmodal desktop review and full-screen mobile review (ux-guidelines.md#conversations-work-and-activity) -->
<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import type { Snippet } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/ui/button';
	import { Dialog as SheetPrimitive } from 'bits-ui';
	import * as Sheet from '$lib/ui/sheet';
	import RoutedSheet from './routed-sheet.svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	let {
		desktop = 'panel',
		id,
		label,
		backLabel = 'Back',
		onclose,
		children
	}: {
		desktop?: 'panel' | 'dialog';
		id?: string;
		label: string;
		backLabel?: string;
		onclose?: () => void;
		children: Snippet;
	} = $props();
	const wide = new MediaQuery('(min-width: 1280px)');
	let panel = $state<HTMLElement | null>(null);
	let mobile = $state<HTMLElement | null>(null);
	let returnFocus: HTMLElement | null = null;
	const panelId = $derived(wide.current && desktop === 'panel' ? id : undefined);
	$effect(() => {
		if (!panelId || !panel) return;
		const target = panel;
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const frame = requestAnimationFrame(() => target.focus({ preventScroll: true }));
		return () => {
			cancelAnimationFrame(frame);
			if (previous?.isConnected) previous.focus({ preventScroll: true });
		};
	});
</script>

<svelte:window
	onkeydown={(event) => {
		if (
			wide.current &&
			desktop === 'panel' &&
			id &&
			event.key === 'Escape' &&
			!event.defaultPrevented
		) {
			event.preventDefault();
			onclose?.();
		}
	}}
/>
{#if wide.current && desktop === 'dialog'}
	<RoutedSheet open={!!id} {label} {onclose}>{@render children()}</RoutedSheet>
{:else if wide.current}
	{#if id}
		<aside
			bind:this={panel}
			tabindex="-1"
			aria-label={label}
			class="flex h-full w-96 shrink-0 flex-col overflow-y-auto overscroll-contain border-l bg-background pt-3 outline-none"
			data-review-scroll={id}
			data-home-inspector
		>
			<div class="flex items-center justify-between px-5 pb-3">
				<span class="text-sm font-medium">Review</span><Button
					variant="ghost"
					size="icon"
					aria-label="Close review"
					onclick={() => onclose?.()}><X /></Button
				>
			</div>
			{@render children()}
		</aside>
	{/if}
{:else}
	<Sheet.Root
		open={!!id}
		onOpenChange={(open) => {
			if (!open) onclose?.();
		}}
	>
		<Sheet.Portal>
			<SheetPrimitive.Content
				bind:ref={mobile}
				aria-label={label}
				data-mobile-review
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					returnFocus =
						document.activeElement instanceof HTMLElement ? document.activeElement : null;
					mobile?.focus({ preventScroll: true });
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
				}}
				class="fixed inset-x-0 top-0 bottom-(--kb) z-20 flex flex-col bg-background pt-(--safe-top) text-foreground outline-none"
			>
				<div class="flex shrink-0 items-center gap-3 border-b px-4 py-3">
					<Button variant="ghost" onclick={() => onclose?.()} aria-label={backLabel}
						><ArrowLeft />Back</Button
					>
					<Sheet.Title class="text-sm font-medium">Review</Sheet.Title>
				</div>
				<div
					data-review-scroll={id}
					class="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-4 pb-(--safe-bottom)"
				>
					{@render children()}
				</div>
			</SheetPrimitive.Content>
		</Sheet.Portal>
	</Sheet.Root>
{/if}
