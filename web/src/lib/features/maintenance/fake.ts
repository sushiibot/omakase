import type { MaintenanceAction, MaintenanceView } from './types';
export function createFixtureMaintenanceApi() {
	const view: MaintenanceView = {
		responsibility: {
			title: 'Keep upcoming plans accurate',
			enabled: true,
			lastReadAt: null,
			lastReviewAt: null,
			lastError: null
		},
		proposals: []
	};
	return {
		list: async () => ({ view: structuredClone(view) }),
		action: async (action: MaintenanceAction) => {
			if (action.action === 'pause') view.responsibility.enabled = !action.paused;
			return { view: structuredClone(view) };
		}
	};
}
