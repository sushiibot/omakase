export interface CalendarProposal {
	id: string;
	revision: number;
	status:
		| 'pending'
		| 'dismissed'
		| 'superseded'
		| 'executing'
		| 'completed'
		| 'conflict'
		| 'uncertain'
		| 'undoing'
		| 'undone';
	createdAt: string;
	updatedAt: string;
	expiresAt: string;
	eventTitle: string;
	eventStart: string;
	eventTimeZone: string | null;
	emailSubject: string;
	emailReceivedAt: string;
	before: string;
	after: string;
	input: { reason: string; excerpts: string[] };
	message?: string;
}
export interface MaintenanceView {
	responsibility: {
		title: string;
		enabled: boolean;
		lastReadAt: string | null;
		lastReviewAt: string | null;
		lastError: string | null;
	};
	proposals: CalendarProposal[];
}
export interface MaintenanceResult {
	view: MaintenanceView;
	error?: string;
}
export type MaintenanceAction =
	| { action: 'pause'; paused: boolean }
	| { action: 'approve' | 'dismiss' | 'undo' | 'reconcile'; id: string; revision: number };
