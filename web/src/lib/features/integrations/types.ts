export interface Integration {
	id: string;
	revision?: string;
	approved?: boolean;
	origin?: string;
	auth?: { type: 'bearer' | 'header'; name?: string };
	operations?: {
		id: string;
		description: string;
		method: string;
		path: string;
		query: string[];
		body: boolean;
	}[];
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
