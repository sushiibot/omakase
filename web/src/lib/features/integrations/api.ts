import { request } from '$lib/core/http';
import type { IntegrationList } from './types';
export const integrationsApi = {
	list: () => request<IntegrationList>('GET', '/integrations'),
	save: (id: string, key: string) =>
		request<IntegrationList>('PUT', `/integrations/${encodeURIComponent(id)}`, { key }),
	remove: (id: string) =>
		request<IntegrationList>('DELETE', `/integrations/${encodeURIComponent(id)}`)
};
