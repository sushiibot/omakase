import { featureHttp } from '$lib/core/feature-http';
import type { ChannelCatalog } from './types';
export interface ChannelsApi {
	list(): Promise<ChannelCatalog>;
}
const http = featureHttp("Conversations aren't available right now.");
export const httpChannelsApi: ChannelsApi = {
	list: () => http.get('/channels')
};
