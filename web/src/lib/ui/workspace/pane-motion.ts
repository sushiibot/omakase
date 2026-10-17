// app: pane drag physics for the phone workspace (ux-guidelines.md#tabs-swipes-and-scroll-ownership)
export type Pane = 'chat' | 'navigation' | 'inspector';

export const motion = {
	intent: 10,
	axisRatio: 1.5,
	edge: 24,
	projectionMs: 160,
	openDistance: 64,
	openFlickDistance: 32,
	closeDistance: 64,
	closeFlickDistance: 32,
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
	inspectorWidth: number,
	startedFrom: Pane = 'chat'
): Pane {
	const speed = Math.max(-2, Math.min(2, velocity));
	if (startedFrom !== 'chat') {
		const width = startedFrom === 'navigation' ? navigationWidth : inspectorWidth;
		const distance = startedFrom === 'navigation' ? width - offset : width + offset;
		const inwardSpeed = startedFrom === 'navigation' ? -speed : speed;
		const threshold = Math.min(motion.closeDistance, width / 4);
		return distance >= Math.min(motion.closeFlickDistance, threshold) &&
			distance + inwardSpeed * motion.projectionMs >= threshold
			? 'chat'
			: startedFrom;
	}
	const side = offset > 0 ? 'navigation' : 'inspector';
	const width = side === 'navigation' ? navigationWidth : inspectorWidth;
	const distance = Math.abs(offset);
	const outwardSpeed = side === 'navigation' ? speed : -speed;
	const threshold = Math.min(motion.openDistance, width / 4);
	if (
		distance >= Math.min(motion.openFlickDistance, threshold) &&
		distance + outwardSpeed * motion.projectionMs >= threshold
	)
		return side;
	return 'chat';
}
