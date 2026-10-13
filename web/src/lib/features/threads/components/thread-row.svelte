<script lang="ts">
	import { onDestroy } from 'svelte';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import { Button } from '$lib/ui/button';
	import * as Item from '$lib/ui/item';
	import { ago } from '$lib/ui/format/time';
	import StatePill from '$lib/ui/status/state-pill.svelte';
	import { cn } from '$lib/utils';
	import ConversationIcon from './conversation-icon.svelte';
	import type { MainSummary, ThreadSummary } from '../types';

	let {
		thread,
		main,
		href,
		now,
		showActivity = true,
		onoptions
	}: {
		/** A thread's row, or Main's when `main` is set. */
		thread?: ThreadSummary;
		main?: MainSummary;
		href: string;
		now: number;
		showActivity?: boolean;
		onoptions?: () => void;
	} = $props();

	const row = $derived(main ?? thread!);
	const title = $derived(main ? (main.title ?? 'Main chat') : thread!.title);
	const archived = $derived(!main && thread?.state === 'archived');
	let timer: ReturnType<typeof setTimeout> | undefined;
	let origin = { x: 0, y: 0 };
	let pressed = false;
	const cancel = () => {
		clearTimeout(timer);
		timer = undefined;
	};
	onDestroy(cancel);
	function press(e: PointerEvent) {
		pressed = false;
		cancel();
		if (!onoptions || e.pointerType === 'mouse' || e.button !== 0) return;
		origin = { x: e.clientX, y: e.clientY };
		timer = setTimeout(() => {
			pressed = true;
			onoptions?.();
		}, 500);
	}
</script>

<div class="flex min-w-0 items-center gap-2">
	<Item.Root class={cn('min-w-0 flex-1 flex-nowrap', archived && 'text-muted-foreground')}>
		{#snippet child({ props })}
			<a
				{href}
				{...props}
				onpointerdown={press}
				onpointerup={cancel}
				onpointercancel={cancel}
				onpointerleave={cancel}
				onpointermove={(e) => {
					if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 10) cancel();
				}}
				onclick={(e) => {
					if (pressed) {
						e.preventDefault();
						pressed = false;
					}
				}}
				oncontextmenu={(e) => {
					if (onoptions) {
						e.preventDefault();
						cancel();
						onoptions();
					}
				}}
			>
				<Item.Media>
					<ConversationIcon main={!!main} class={main ? 'size-11' : 'size-10'} />
				</Item.Media>
				<Item.Content class="min-w-0 gap-0.5">
					<span class="flex items-baseline justify-between gap-3">
						<span class="truncate font-medium">{title}</span>
						{#if showActivity}<span class="shrink-0 text-xs text-muted-foreground tabular-nums"
								>{ago(row.lastActivity, now)}</span
							>{/if}
					</span>
					<span class="flex items-center gap-2">
						<span class="line-clamp-1 flex-1 [overflow-wrap:anywhere] text-muted-foreground"
							>{row.preview}</span
						>
						{#if row.state === 'needs-you'}
							<StatePill of="waiting" label="Needs you" />
						{:else if row.state === 'running'}
							<StatePill of="running" />
						{:else if row.unread}
							<span
								class="min-w-5 shrink-0 rounded-full bg-primary px-1.5 text-center text-meta leading-5 font-semibold text-primary-foreground tabular-nums"
								>{row.unread}<span class="sr-only"> unread</span></span
							>
						{/if}
					</span>
				</Item.Content>
			</a>
		{/snippet}
	</Item.Root>

	{#if onoptions}<Button
			variant="ghost"
			size="icon"
			aria-haspopup="dialog"
			aria-label="Options for {title}"
			onclick={onoptions}><Ellipsis /></Button
		>{/if}
</div>
