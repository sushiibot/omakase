import { request, HttpError } from '$lib/core/http';
import type { MailAccount, MailProvider } from './types';
async function call<T>(path: string, body?: unknown): Promise<T> {
	try {
		return await request<T>(body === undefined ? 'GET' : 'POST', path, body);
	} catch (error) {
		if (
			error instanceof HttpError &&
			typeof (error.body as { error?: unknown })?.error === 'string'
		)
			throw new Error((error.body as { error: string }).error);
		throw error;
	}
}
export const mailApi = {
	list: () => call<{ accounts: MailAccount[]; providers: MailProvider[] }>('/mail'),
	connect: (
		provider: string,
		auth: 'oauth' | 'token',
		input: { name: string; purpose: string; token?: string; reconnectId?: string }
	) =>
		call<{ url?: string; account?: MailAccount }>(
			`/mail/providers/${encodeURIComponent(provider)}/${auth === 'oauth' ? 'begin' : 'token'}`,
			input
		),
	rename: (id: string, name: string, purpose: string) =>
		call(`/mail/accounts/${encodeURIComponent(id)}/rename`, { name, purpose }),
	remove: (id: string) =>
		call<{ message: string }>(`/mail/accounts/${encodeURIComponent(id)}/remove`, {})
};
