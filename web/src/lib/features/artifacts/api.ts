import { featureHttp, enc } from '$lib/core/feature-http';
import type { Artifact, ArtifactList } from './types';
const http = featureHttp("Artifacts aren't available yet.");
export const artifactsApi = {
	list: (query = '') => http.get<ArtifactList>(`/artifacts?q=${encodeURIComponent(query)}`),
	get: (id: string) => http.find<Artifact>(`/artifacts/${enc(id)}`)
};
