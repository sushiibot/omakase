import { Remote } from '$lib/core/remote.svelte';
import { featureHttp } from '$lib/core/feature-http';
import type { MaintenanceAction, MaintenanceResult } from './types';
const http = featureHttp('Calendar maintenance is unavailable.');
interface MaintenanceApi {
	list(): Promise<MaintenanceResult>;
	action(action: MaintenanceAction): Promise<MaintenanceResult>;
}
let api: MaintenanceApi = {
	list: () => http.get<MaintenanceResult>('/maintenance'),
	action: (action) => http.post<MaintenanceResult>('/maintenance', action)
};
class MaintenanceStore {
	remote = new Remote(() => api.list(), { refetchOnFocus: true });
	busy = $state(false);
	error = $state<string | null>(null);
	async act(action: MaintenanceAction) {
		if (this.busy) return;
		this.busy = true;
		this.error = null;
		try {
			const result = await api.action(action);
			await this.remote.refetch();
			this.error = result.error ?? null;
		} catch (error) {
			this.error =
				error instanceof Error
					? error.message
					: 'Could not confirm the result. Refresh before trying again.';
			await this.remote.refetch();
		} finally {
			this.busy = false;
		}
	}
}
let singleton: MaintenanceStore | undefined;
export function maintenanceStore() {
	return (singleton ??= new MaintenanceStore());
}

export function configureMaintenance(next: MaintenanceApi) {
	api = next;
	singleton = undefined;
}
