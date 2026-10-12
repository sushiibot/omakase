import { request, HttpError } from '$lib/core/http';
import type { FileStore, FileStoreInput } from './types';
export class FileStoreApiError extends Error {
	constructor(
		message: string,
		readonly fields: Record<string, string[]> = {}
	) {
		super(message);
	}
}
async function call<T>(path: string, body?: unknown): Promise<T> {
	try {
		return await request<T>(body === undefined ? 'GET' : 'POST', path, body);
	} catch (error) {
		const message = error instanceof HttpError && (error.body as { error?: unknown })?.error;
		if (typeof message === 'string')
			throw new FileStoreApiError(
				message,
				((error as HttpError).body as { fields?: Record<string, string[]> } | undefined)?.fields
			);
		throw error;
	}
}
export const fileStoresApi = {
	list: () => call<{ stores: FileStore[] }>('/file-stores'),
	save: (input: FileStoreInput) => call<{ store: FileStore }>('/file-stores', input),
	test: (id: string) =>
		call<{
			ok: boolean;
			message: string;
			folders?: { path: string; ok: boolean; message: string }[];
		}>(`/file-stores/${encodeURIComponent(id)}/test`, {}),
	remove: (store: FileStore) =>
		call<{ removed: true }>(`/file-stores/${encodeURIComponent(store.id)}/remove`, {
			revision: store.revision
		})
};
