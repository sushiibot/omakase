<script lang="ts">
	import Pause from '@lucide/svelte/icons/pause';
	import Play from '@lucide/svelte/icons/play';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import TimerIcon from '@lucide/svelte/icons/timer';
	import { untrack } from 'svelte';
	import { Button } from '$lib/ui/button';
	import { formatDuration } from '../rich/blocks';
	import { loadLocal, saveLocal } from './local-state';
	import type { LiveBinding } from '../rich/live';

	// A countdown. Bound to a stored block (`live`), its end time is shared by every device and the
	// agent; otherwise it is kept on this device. A running timer stores its end time either way, so
	// it keeps counting through a reload or the app going to the background.
	let {
		label,
		seconds,
		storeKey,
		compact = false,
		disabled = false,
		live
	}: {
		label: string;
		seconds: number;
		storeKey: string;
		compact?: boolean;
		/** Shown but not startable yet: the block is still streaming and its key isn't final. */
		disabled?: boolean;
		live?: LiveBinding;
	} = $props();

	type Saved = { endsAt: number | null; left: number };
	// A block's key and duration come from its text, which doesn't change once rendered.
	const initial = untrack(() => loadLocal<Saved | null>(`timer:${storeKey}`, null));
	let localEndsAt = $state<number | null>(initial?.endsAt ?? null);
	let localLeft = $state(initial?.left ?? untrack(() => seconds));
	const total = $derived(live ? (live.block.data as { duration: number }).duration : seconds);
	const endsAt = $derived(
		live ? (live.block.state.endsAt ? Date.parse(live.block.state.endsAt) : null) : localEndsAt
	);
	const left = $derived(live ? (live.block.state.left ?? total) : localLeft);
	let now = $state(Date.now());
	const remaining = $derived(
		endsAt === null ? left : Math.max(0, Math.ceil((endsAt - now) / 1000))
	);
	const done = $derived(remaining === 0);
	const running = $derived(endsAt !== null && !done);

	$effect(() => {
		if (endsAt === null) return;
		const id = setInterval(() => (now = Date.now()), 250);
		return () => clearInterval(id);
	});
	let buzzed = false;
	$effect(() => {
		if (done && endsAt !== null && !buzzed) {
			buzzed = true;
			navigator.vibrate?.([200, 100, 200]);
		}
	});

	function persist() {
		saveLocal(`timer:${storeKey}`, { endsAt: localEndsAt, left: localLeft } satisfies Saved);
	}
	function start() {
		now = Date.now();
		buzzed = false;
		if (live) return live.apply([{ op: 'start' }]);
		localEndsAt = now + (done ? total : left) * 1000;
		persist();
	}
	function pause() {
		if (live) return live.apply([{ op: 'pause' }]);
		localLeft = remaining;
		localEndsAt = null;
		persist();
	}
	function reset() {
		buzzed = false;
		if (live) return live.apply([{ op: 'reset' }]);
		localLeft = total;
		localEndsAt = null;
		persist();
	}
</script>

<div
	class={[
		'flex items-center gap-2',
		!compact && 'my-1 rounded-xl border bg-card p-3 text-card-foreground',
		done && endsAt !== null && 'text-review'
	]}
>
	<TimerIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
	{#if !compact}<span class="min-w-0 flex-1 text-sm font-medium">{label}</span>{/if}
	<span
		class="text-sm tabular-nums"
		role="timer"
		aria-label="{label}: {formatDuration(remaining)} left"
		>{done && endsAt !== null ? 'Done' : formatDuration(remaining)}</span
	>
	<span class="sr-only" aria-live="polite"
		>{done && endsAt !== null ? `${label}: time's up` : ''}</span
	>
	{#if running}
		<Button
			data-rich-control
			variant="ghost"
			size="icon-sm"
			aria-label="Pause {label}"
			onclick={pause}><Pause /></Button
		>
	{:else}
		<Button
			data-rich-control
			variant="ghost"
			size="icon-sm"
			aria-label="Start {label}"
			{disabled}
			onclick={start}><Play /></Button
		>
	{/if}
	{#if endsAt !== null || left !== total}
		<Button
			data-rich-control
			variant="ghost"
			size="icon-sm"
			aria-label="Reset {label}"
			onclick={reset}><RotateCcw /></Button
		>
	{/if}
</div>
