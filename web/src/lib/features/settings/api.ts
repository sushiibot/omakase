import { featureHttp } from '$lib/core/feature-http';
import type { OwnerName } from './types';

export interface SettingsApi {
	ownerName(): Promise<OwnerName>;
	/** null clears the name. */
	setOwnerName(name: string | null): Promise<OwnerName>;
}

const http = featureHttp("This agent version can't save your name yet.");

export const httpSettingsApi: SettingsApi = {
	ownerName: () => http.get('/settings/owner-name'),
	setOwnerName: (name) => http.post('/settings/owner-name', { name })
};
