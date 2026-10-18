export interface Account {
	id: string;
	name: string;
	origin: string;
	username: string;
	status: 'pending' | 'active' | 'archived';
	version: number;
	confirmedVersion?: number;
	createdAt: number;
	updatedAt: number;
}
export interface AuditEvent {
	id: string;
	accountId: string;
	version?: number;
	action: string;
	actor: string;
	at: number;
	origin?: string;
	engine?: string;
	runId?: string;
	outcome?: string;
}
