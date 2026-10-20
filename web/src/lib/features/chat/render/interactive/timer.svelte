<script lang="ts">
	import Pause from '@lucide/svelte/icons/pause';
	import Play from '@lucide/svelte/icons/play';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import TimerIcon from '@lucide/svelte/icons/timer';
	import { untrack } from 'svelte';
	import { Button } from '$lib/ui/button';
	import { formatDuration } from '../rich/blocks';
	import { loadLocal, saveLocal } from './local-state';

	// A countdown kept on this device. A running timer stores its end time, so it keeps counting
	// through a reload or the app going to the background.
	let {
		label,
		seconds,
		storeKey,
		compact = false
	}: { label: string; seconds: number; storeKey: string; compact?: boolean } = $props();

	type Saved = { endsAt: number | null; left: number };
	// A block's key and duration come from its text, which doesn't change once rendered.
	const initial = untrack(() => loadLocal<Saved | null>(`timer:${storeKey}`, null));
	let endsAt = $state<number | null>(initial?.endsAt ?? null);
	let left = $state(initial?.left ?? untrack(() => seconds));
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
		saveLocal(`timer:${storeKey}`, { endsAt, left } satisfies Saved);
	}
	function start() {
		now = Date.now();
		endsAt = now + (done ? seconds : left) * 1000;
		buzzed = false;
		persist();
	}
	function pause() {
		left = remaining;
		endsAt = null;
		persist();
	}
	function reset() {
		left = seconds;
		endsAt = null;
		buzzed = false;
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
			onclick={start}><Play /></Button
		>
	{/if}
	{#if endsAt !== null || left !== seconds}
		<Button
			data-rich-control
			variant="ghost"
			size="icon-sm"
			aria-label="Reset {label}"
			onclick={reset}><RotateCcw /></Button
		>
	{/if}
</div>
