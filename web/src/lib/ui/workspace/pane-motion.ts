export type Pane = 'chat' | 'navigation' | 'inspector';

export const motion = {
	intent: 10,
	axisRatio: 1.5,
	edge: 24,
	projectionMs: 160,
	settleMs: 200
};

export function horizontalIntent(dx: number, dy: number): boolean {
	return Math.abs(dx) >= motion.intent && Math.abs(dx) >= Math.abs(dy) * motion.axisRatio;
}

export function offsetFor(pane: Pane, navigationWidth: number, inspectorWidth: number): number {
	return pane === 'navigation' ? navigationWidth : pane === 'inspector' ? -inspectorWidth : 0;
}

export function clampOffset(
	offset: number,
	navigationWidth: number,
	inspectorWidth: number
): number {
	return Math.max(-inspectorWidth, Math.min(navigationWidth, offset));
}

/** Velocity selects a destination. It never sets the duration of the settling animation. */
export function releasePane(
	offset: number,
	velocity: number,
	navigationWidth: number,
	inspectorWidth: number
): Pane {
	const projected = offset + Math.max(-2, Math.min(2, velocity)) * motion.projectionMs;
	if (projected > navigationWidth / 2) return 'navigation';
	if (projected < -inspectorWidth / 2) return 'inspector';
	return 'chat';
}
