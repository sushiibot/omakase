<!-- app: stock Sheet opened through history so Android back closes it (ux-guidelines.md#back-gesture-and-navigation) -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Dialog as SheetPrimitive } from 'bits-ui';
	import * as Sheet from '$lib/ui/sheet';
	import { cn } from '$lib/utils';

	let {
		open,
		label,
		onclose,
		desktop = true,
		returnFocus,
		children
	}: {
		open: boolean;
		label: string;
		/** Escape, a tap on the scrim, or a close inside; the caller owns the history entry. */
		onclose?: () => void;
		/** Show at desktop widths too, as a centred dialog. Off only for a sheet whose content has
		 *  a desktop home of its own; such a sheet closes itself there. */
		desktop?: boolean;
		/** Restore focus without moving the conversation after this sheet closes. */
		returnFocus?: HTMLElement | null;
		children: Snippet;
	} = $props();

	let content = $state<HTMLElement | null>(null);
	let probe = $state<HTMLElement | null>(null);
	let wide = $state(false);
	let dragOffset = $state(0);
	let dragging = $state(false);
	let gesture: { id: number; y: number } | null = null;
	let suppressClick = false;
	$effect(() => {
		if (open) {
			dragOffset = 0;
			dragging = false;
			gesture = null;
		}
	});

	function startDrag(event: PointerEvent) {
		if (wide || !event.isPrimary || event.button !== 0) return;
		gesture = { id: event.pointerId, y: event.clientY };
		suppressClick = false;
		dragging = true;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}
	function moveDrag(event: PointerEvent) {
		if (gesture?.id !== event.pointerId) return;
		dragOffset = Math.max(0, event.clientY - gesture.y);
		if (Math.abs(event.clientY - gesture.y) > 8) suppressClick = true;
	}
	function endDrag(event: PointerEvent) {
		if (gesture?.id !== event.pointerId) return;
		gesture = null;
		dragging = false;
		if (dragOffset >= Math.min(120, (content?.clientHeight ?? 480) / 4)) onclose?.();
		else dragOffset = 0;
	}
	function cancelDrag() {
		gesture = null;
		dragging = false;
		dragOffset = 0;
		suppressClick = true;
	}
	const shown = $derived(open && (desktop || !wide));
	// A sheet that can't show must not keep its history entry, or Back is spent on nothing.
	$effect(() => {
		if (open && !shown) onclose?.();
	});

	// Desktop is the shell's width, not the window's, so a phone frame on the prototype board
	// still gets phone sheets. Matches the shell's @3xl breakpoint.
	$effect(() => {
		const box = probe?.closest<HTMLElement>('[data-shell]') ?? document.documentElement;
		const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
		const ro = new ResizeObserver(() => (wide = box.clientWidth >= 48 * rem));
		ro.observe(box);
		return () => ro.disconnect();
	});

	function focusFirst(e: Event) {
		e.preventDefault();
		const target = content?.querySelector<HTMLElement>('[data-autofocus]') ?? content;
		target?.focus({ preventScroll: true });
	}
</script>

<span bind:this={probe} hidden></span>
<Sheet.Root
	open={shown}
	onOpenChange={(next) => {
		if (!next) onclose?.();
	}}
>
	<Sheet.Portal>
		<Sheet.Overlay class="z-20 bg-scrim supports-backdrop-filter:backdrop-blur-none" />
		<SheetPrimitive.Content
			bind:ref={content}
			data-routed-sheet
			style={wide
				? 'inset: auto; top: 50%; left: 50%; translate: -50% -50%'
				: `translate: 0 ${dragOffset}px; transition: translate ${dragging ? '0ms' : 'var(--duration-medium)'} var(--ease-standard)`}
			aria-label={label}
			onOpenAutoFocus={focusFirst}
			onCloseAutoFocus={(e) => {
				if (returnFocus) {
					e.preventDefault();
					returnFocus.focus({ preventScroll: true });
				}
			}}
			class={cn(
				'fixed inset-x-0 bottom-(--kb) z-20 flex max-h-[88%] flex-col overflow-y-auto overscroll-contain rounded-t-3xl bg-background pb-(--safe-bottom) text-foreground shadow-[0_-12px_40px_-12px_rgb(0_0_0/0.4)] outline-none kb:pb-0',
				'duration-(--duration-medium) ease-(--ease-standard) motion-reduce:animate-none! motion-reduce:transition-none! data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
				!(desktop && wide) &&
					'data-open:slide-in-from-bottom-10 data-closed:slide-out-to-bottom-full',
				desktop &&
					wide &&
					'w-full max-w-md rounded-3xl pb-0 data-open:zoom-in-95 data-closed:zoom-out-95'
			)}
		>
			<button
				type="button"
				aria-label={`Close ${label}`}
				class={cn(
					'flex h-12 shrink-0 touch-none items-center justify-center rounded-t-3xl outline-none focus-visible:ring-2 focus-visible:ring-ring',
					desktop && wide && 'hidden'
				)}
				onpointerdown={startDrag}
				onpointermove={moveDrag}
				onpointerup={endDrag}
				onpointercancel={cancelDrag}
				onlostpointercapture={() => gesture && cancelDrag()}
				onclick={(event) => {
					if (!suppressClick || event.detail === 0) onclose?.();
					suppressClick = false;
				}}
			>
				<span class="h-1 w-9 rounded-full bg-muted-foreground/35" aria-hidden="true"></span>
			</button>
			{@render children()}
		</SheetPrimitive.Content>
	</Sheet.Portal>
</Sheet.Root>
