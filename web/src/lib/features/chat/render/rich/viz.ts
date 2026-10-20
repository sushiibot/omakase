import type { Tone } from './blocks';

// Class names for rich blocks, spelled out in full so Tailwind finds them.

/** Categorical fills, in order; series past six reuse them. */
const VIZ_FILL = ['bg-viz-1', 'bg-viz-2', 'bg-viz-3', 'bg-viz-4', 'bg-viz-5', 'bg-viz-6'] as const;
export const vizFill = (i: number) => VIZ_FILL[i % VIZ_FILL.length];

/** A tinted surface with its matching text color, from the status tokens. */
export const toneSurface: Record<Tone, string> = {
	neutral: 'bg-muted',
	info: 'bg-running-soft',
	success: 'bg-review-soft',
	warn: 'bg-waiting-soft',
	danger: 'bg-failed-soft'
};

/** Icon and accent color for a tone; never the only signal, a label always goes with it. */
export const toneText: Record<Tone, string> = {
	neutral: 'text-muted-foreground',
	info: 'text-running',
	success: 'text-review',
	warn: 'text-waiting',
	danger: 'text-failed'
};

export const toneDot: Record<Tone, string> = {
	neutral: 'bg-muted-foreground',
	info: 'bg-running',
	success: 'bg-review',
	warn: 'bg-waiting',
	danger: 'bg-failed'
};

export const toneLabel: Record<Tone, string> = {
	neutral: 'Note',
	info: 'Info',
	success: 'Good',
	warn: 'Warning',
	danger: 'Important'
};
