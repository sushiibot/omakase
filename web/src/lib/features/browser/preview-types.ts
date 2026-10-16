export interface BrowserPreviewStatus {
	id: string;
	conversationId: string;
	state: 'starting' | 'active' | 'ended';
	runId: string | null;
	engine?: 'chromium' | 'camoufox';
	profile?: 'owner' | 'temporary';
	control?: 'agent' | 'owner';
	url?: string;
	action: string;
	endedAt?: number;
}
export interface BrowserPreviewFrame {
	seq: number;
	data: string;
	width: number;
	height: number;
	capturedAt: number;
}

export type BrowserInput =
	| { kind: 'click'; x: number; y: number }
	| { kind: 'text'; text: string }
	| { kind: 'key'; key: string }
	| { kind: 'scroll'; direction: 'up' | 'down' };
