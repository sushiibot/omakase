// Which finished agents the owner has opened on this device, for the unread dot.
const KEY = 'agents:seen';

function read(): Record<string, string> {
	try {
		return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
	} catch {
		return {};
	}
}

export function unseen(id: string, updatedAt: string): boolean {
	const at = read()[id];
	return !at || at < updatedAt;
}

export function markSeen(id: string, updatedAt: string) {
	try {
		const seen = read();
		seen[id] = updatedAt;
		const entries = Object.entries(seen).sort((a, b) => b[1].localeCompare(a[1]));
		localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries.slice(0, 300))));
	} catch {
		/* Private mode: the dot stays until the result changes. */
	}
}
