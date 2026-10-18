import type { Account, AuditEvent } from './types';
// Credentials bypass the offline HTTP cache. Never retain or display server error bodies.
async function call<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
	const response = await fetch(`/api/accounts${path}`, {
		method: body === undefined ? 'GET' : 'POST',
		credentials: 'same-origin',
		cache: 'no-store',
		signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
		headers: body === undefined ? undefined : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	if (!response.ok) throw new Error('Account request failed.');
	return response.json();
}
export const accountsApi = {
	list: (signal: AbortSignal) => call<{ accounts: Account[] }>('', signal),
	audit: (id: string, signal: AbortSignal) =>
		call<{ events: AuditEvent[] }>(`/${encodeURIComponent(id)}/audit`, signal),
	reveal: (id: string, version: number, purpose: 'reveal' | 'copy', signal: AbortSignal) =>
		call<{ password: string; version: number }>(`/${encodeURIComponent(id)}/reveal`, signal, {
			version,
			purpose
		}),
	archive: (account: Account, signal: AbortSignal) =>
		call<{ account: Account }>(`/${encodeURIComponent(account.id)}/archive`, signal, {
			expectedVersion: account.version
		})
};
