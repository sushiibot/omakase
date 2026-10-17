export type MailAccount = {
	id: string;
	provider: string;
	email: string;
	name: string;
	purpose: string;
	status: 'connected' | 'needs-attention';
	problem?: string;
};
export type MailProvider = {
	id: string;
	name: string;
	auth: 'oauth' | 'token';
	configured: boolean;
	setupHelp?: string;
	connectLabel?: string;
};
