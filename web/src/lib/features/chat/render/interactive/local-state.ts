// Device-local state for interactive reply blocks (ticks, servings, timers), keyed by the block's
// text so it survives a reload and needs no server. Never sent anywhere.

const PREFIX = 'rich:';

export function loadLocal<T>(key: string, fallback: T): T {
	try {
		const raw = globalThis.localStorage?.getItem(PREFIX + key);
		return raw === null || raw === undefined ? fallback : (JSON.parse(raw) as T);
	} catch {
		return fallback;
	}
}

export function saveLocal(key: string, value: unknown): void {
	try {
		globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
	} catch {
		// Private mode or a full quota: the tick still shows until reload.
	}
}
