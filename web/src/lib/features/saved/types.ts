// Saved items: the documents and stored checklists, recipes and timers the agent made, as one list.
// Matches `savedItem` in src/orchestration/savedContracts.ts.

export type SavedKind = 'document' | 'checklist' | 'recipe' | 'timer';
export type SavedStatus = 'active' | 'done';
export type SavedAction = 'pin' | 'unpin' | 'archive' | 'restore' | 'opened';

export interface SavedItem {
	kind: SavedKind;
	id: string;
	title: string;
	conversationId: string;
	/** The reply it came from, for a `?m=` link; null when unknown. */
	sourceMessageId: string | null;
	status: SavedStatus;
	pinned: boolean;
	archived: boolean;
	createdAt: string;
	updatedAt: string;
	updatedBy: 'owner' | 'agent';
	/** One line of current state, such as "3 of 7 done". */
	summary: string;
	/** A running timer's end. */
	endsAt?: string;
	/** A checklist's ticked and total items. */
	progress?: { done: number; total: number };
}

export interface SavedList {
	items: SavedItem[];
	truncated?: boolean;
}

export interface SavedFilter {
	conversationId?: string;
	status?: SavedStatus | 'all';
	kind?: SavedKind;
	pinned?: boolean;
	query?: string;
}

export interface Artifact {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	conversationId: string;
	version: number;
	content: string;
}
