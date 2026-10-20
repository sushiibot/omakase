<script lang="ts">
	import { withUnit, richPlainText, type RichData } from './blocks';
	import Frame from './frame.svelte';

	// One series as a line. The SVG stretches to the width; labels are HTML so text never distorts.
	// A block still streaming may have no point or one yet: one sits in the middle, none shows nothing.
	let { data }: { data: RichData<'line'> } = $props();
	const W = 300;
	const H = 100;
	const ys = $derived(data.points.map((p) => p.y));
	const lo = $derived(Math.min(...ys));
	const hi = $derived(Math.max(...ys));
	const span = $derived(hi - lo || Math.abs(hi) || 1);
	const coords = $derived(
		data.points.map(
			(p, i) =>
				[
					data.points.length > 1 ? (i / (data.points.length - 1)) * W : W / 2,
					H - 6 - ((p.y - lo) / span) * (H - 12)
				] as const
		)
	);
	const line = $derived(coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
	const area = $derived(`0,${H} ${line} ${W},${H}`);
	const last = $derived(data.points.at(-1));
	const middle = $derived(
		data.points.length > 2 ? data.points[Math.floor((data.points.length - 1) / 2)] : null
	);
</script>

<Frame title={data.title} note={data.note} label={richPlainText({ type: 'line', data })}>
	{#if last}
		<div class="flex flex-col gap-1" aria-hidden="true">
			<div class="flex items-baseline justify-between text-xs text-muted-foreground">
				<span>High {withUnit(hi, data.unit)}</span>
				<span class="text-foreground"
					>{last.x}:
					<span class="font-medium tabular-nums">{withUnit(last.y, data.unit)}</span></span
				>
			</div>
			<svg
				viewBox="0 0 {W} {H}"
				preserveAspectRatio="none"
				class="h-28 w-full overflow-visible text-viz-1"
			>
				<polygon points={area} class="fill-current opacity-15" />
				<polyline
					points={line}
					fill="none"
					class="stroke-current"
					stroke-width="2"
					stroke-linejoin="round"
					stroke-linecap="round"
					vector-effect="non-scaling-stroke"
				/>
			</svg>
			<div class="flex justify-between gap-2 text-xs text-muted-foreground">
				<span>{data.points[0].x}</span>
				{#if middle}<span>{middle.x}</span>{/if}
				<span>{last.x}</span>
			</div>
			<span class="text-xs text-muted-foreground">Low {withUnit(lo, data.unit)}</span>
		</div>
	{/if}
</Frame>
