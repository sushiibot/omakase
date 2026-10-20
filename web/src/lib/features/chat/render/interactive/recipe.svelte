<script lang="ts">
	import Clock from '@lucide/svelte/icons/clock';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import Users from '@lucide/svelte/icons/users';
	import { untrack } from 'svelte';
	import { Button } from '$lib/ui/button';
	import { Checkbox } from '$lib/ui/checkbox';
	import { stepDuration, type RichData } from '../rich/blocks';
	import Frame from '../rich/frame.svelte';
	import { hashText } from '../markdown';
	import { loadLocal, saveLocal } from './local-state';
	import { scaleQty } from './scale';
	import Timer from './timer.svelte';
	import type { LiveBinding } from '../rich/live';

	// A recipe: servings rescale the amounts, ingredients tick off, and a step that names a time
	// gets a timer. Bound to a stored block (`live`), servings and ticks are shared by every device
	// and the agent; otherwise they stay on this device. Step timers are always local.
	let {
		data,
		partial = false,
		live
	}: {
		data: RichData<'recipe'>;
		/** Still streaming: lists grow and the controls wait for the finished block, whose key the
		 *  saved state belongs to. rich-block.svelte mounts the finished block afresh. */
		partial?: boolean;
		live?: LiveBinding;
	} = $props();
	const uid = $props.id();
	const key = $derived(hashText(JSON.stringify(data)));
	// A finished block's data doesn't change, so its saved state is read once.
	const saved = untrack(() =>
		loadLocal<{ serves?: number; got?: Record<number, boolean> }>(`recipe:${key}`, {})
	);
	let localServes = $state(saved.serves ?? untrack(() => data.serves) ?? 0);
	let localGot = $state<Record<number, boolean>>(saved.got ?? {});
	const serves = $derived(live ? (live.block.state.serves ?? data.serves ?? 0) : localServes);
	const got = $derived<Record<number, boolean>>(
		live ? Object.fromEntries((live.block.state.got ?? []).map((i) => [i, true])) : localGot
	);
	// While partial, `serves` (read once, above) may predate the line that sets it.
	const shownServes = $derived(partial ? (data.serves ?? 0) : serves);
	const factor = $derived(data.serves && shownServes ? shownServes / data.serves : 1);
	const times = $derived(
		data.time
			? (['prep', 'cook', 'total'] as const).flatMap((k) =>
					data.time?.[k] ? [`${k[0].toUpperCase()}${k.slice(1)} ${data.time[k]}`] : []
				)
			: []
	);

	function persist() {
		saveLocal(`recipe:${key}`, { serves: localServes, got: localGot });
	}
	function setServes(n: number) {
		const next = Math.min(100, Math.max(1, n));
		if (live) return live.apply([{ op: 'serves', n: next }]);
		localServes = next;
		persist();
	}
	function tick(i: number, done: boolean) {
		if (live) return live.apply([{ op: 'got', item: i, done }]);
		localGot = { ...localGot, [i]: done };
		persist();
	}
</script>

<Frame note={data.notes}>
	<div class="flex flex-col gap-1">
		<span class="text-base font-semibold">{data.title}</span>
		{#if data.serves || times.length}
			<span class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
				{#if data.serves}
					<span class="flex items-center gap-1">
						<Users class="size-3.5" aria-hidden="true" />
						<Button
							data-rich-control
							variant="ghost"
							size="icon-xs"
							aria-label="Fewer servings"
							disabled={partial || serves <= 1}
							onclick={() => setServes(serves - 1)}><Minus /></Button
						>
						<span class="tabular-nums" aria-live="polite">Serves {shownServes}</span>
						<Button
							data-rich-control
							variant="ghost"
							size="icon-xs"
							aria-label="More servings"
							disabled={partial || serves >= 100}
							onclick={() => setServes(serves + 1)}><Plus /></Button
						>
					</span>
				{/if}
				{#if times.length}<span class="flex items-center gap-1"
						><Clock class="size-3.5" aria-hidden="true" />{times.join(' · ')}</span
					>{/if}
			</span>
		{/if}
	</div>
	<div class="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
		<section class="flex flex-col gap-2" aria-label="Ingredients">
			<span class="text-xs font-medium text-muted-foreground">Ingredients</span>
			<ul class="flex flex-col divide-y">
				{#each data.ingredients as ing, i (i)}
					<li class="flex items-start gap-2.5 py-1.5">
						<Checkbox
							data-rich-control
							class="mt-1"
							aria-labelledby="{uid}-ing-{i}"
							disabled={partial}
							checked={got[i] ?? false}
							onCheckedChange={(v) => tick(i, v === true)}
						/>
						<span
							id="{uid}-ing-{i}"
							class={['flex gap-2', got[i] && 'text-muted-foreground line-through']}
						>
							{#if ing.qty !== undefined || ing.unit}<span class="shrink-0 font-medium tabular-nums"
									>{[ing.qty !== undefined ? scaleQty(ing.qty, factor) : undefined, ing.unit]
										.filter((x) => x !== undefined)
										.join(' ')}</span
								>{/if}
							<span
								>{ing.item}{#if ing.note}<span class="text-muted-foreground">, {ing.note}</span
									>{/if}</span
							>
						</span>
					</li>
				{/each}
			</ul>
		</section>
		<section class="flex flex-col gap-2" aria-label="Steps">
			<span class="text-xs font-medium text-muted-foreground">Steps</span>
			<ol class="flex flex-col gap-3">
				{#each data.steps as step, i (i)}
					{@const seconds = stepDuration(step)}
					<li class="flex gap-3">
						<span
							class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums"
							aria-hidden="true">{i + 1}</span
						>
						<div class="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
							<span>{step}</span>
							{#if seconds}<Timer
									compact
									label="Step {i + 1}"
									{seconds}
									storeKey="{key}:{i}"
									disabled={partial}
								/>{/if}
						</div>
					</li>
				{/each}
			</ol>
		</section>
	</div>
</Frame>
