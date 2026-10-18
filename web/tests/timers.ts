import { jest } from 'bun:test';
import { setImmediate } from 'node:timers';

/** Let promise continuations finish without advancing application timers. */
export const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

export async function advance(ms: number) {
	jest.advanceTimersByTime(ms);
	await settle();
}

export function restoreTimers() {
	jest.clearAllTimers();
	jest.useRealTimers();
}
