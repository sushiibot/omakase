/** Read-only GET /api/channels projection. Existing conversation IDs remain route identities. */
export interface Channel {
	id: string;
	title: string;
	kind: 'main' | 'channel' | 'task';
	taskId?: string;
	state: 'archived' | 'needs-you' | 'running' | 'idle';
	lastActivity: string | null;
	preview: string;
	pending: { asks: number; approvals: number; total: number };
	attention: { kind: 'ask' | 'approval'; id: string; seq: number; at: string }[];
	activity: { running: boolean; turnCount: number };
	/** The global SSE cursor, not a channel-specific unread count. */
	headSeq: number;
	lastMessageSeq: number | null;
	/** No durable read receipts exist yet. */
	unread: null;
	archived?: { at: string; by: 'you' | 'idle' | null };
}
export interface ChannelCatalog {
	channels: Channel[];
	archiveAfterDays: number;
}
export type ChannelView = 'all' | 'recent' | 'needs-you';
export interface ChannelFilter {
	search?: string;
	includeArchived?: boolean;
}
