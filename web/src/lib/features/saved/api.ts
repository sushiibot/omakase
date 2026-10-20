import { enc, featureHttp } from '$lib/core/feature-http';
import type { Artifact, SavedAction, SavedFilter, SavedItem, SavedList } from './types';

export interface SavedApi {
	list(filter: SavedFilter): Promise<SavedList>;
	/** null: no such item. */
	get(id: string): Promise<SavedItem | null>;
	act(id: string, action: SavedAction): Promise<SavedItem>;
	/** A saved document's content; null when it doesn't exist. */
	document(id: string): Promise<Artifact | null>;
}

const http = featureHttp("Saved items aren't available yet.");
const documents = featureHttp("Documents aren't available yet.");

export function savedQuery(filter: SavedFilter): string {
	const q = new URLSearchParams();
	if (filter.status) q.set('status', filter.status);
	if (filter.conversationId) q.set('conversation', filter.conversationId);
	if (filter.kind) q.set('kind', filter.kind);
	if (filter.pinned !== undefined) q.set('pinned', filter.pinned ? '1' : '0');
	if (filter.query?.trim()) q.set('q', filter.query.trim());
	const s = q.toString();
	return s ? `?${s}` : '';
}

export const httpSavedApi: SavedApi = {
	list: (filter) => http.get<SavedList>(`/saved${savedQuery(filter)}`),
	get: async (id) => (await http.find<SavedList>(`/saved?id=${enc(id)}`))?.items[0] ?? null,
	act: async (id, action) => {
		const { items } = await http.post<SavedList>('/saved', { action, id });
		return items[0];
	},
	document: (id) => documents.find<Artifact>(`/artifacts/${enc(id)}`)
};
