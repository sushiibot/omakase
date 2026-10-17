export interface Integration {
	id: string;
	name: string;
	capability: string;
	configured: boolean;
	source?: 'saved' | 'environment' | null;
	setupUrl: string;
	steps: string[];
	links: { label: string; url: string }[];
}
export interface IntegrationList {
	integrations: Integration[];
}
