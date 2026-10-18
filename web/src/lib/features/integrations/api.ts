import { request } from '$lib/core/http';
import type { IntegrationList } from './types';
export const integrationsApi = {
	list: () => request<IntegrationList>('GET', '/integrations'),
	save: (id: string, key: string, revision?: string) =>
		request<IntegrationList>('PUT', `/integrations/${encodeURIComponent(id)}`, {
			key,
			...(revision ? { revision, approved: true } : {})
		}),
	remove: (id: string) =>
		request<IntegrationList>('DELETE', `/integrations/${encodeURIComponent(id)}`)
};
