export type AgentStatus =
	'running' | 'needs-you' | 'completed' | 'failed' | 'stopped' | 'interrupted';
export type Decision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';

/** A Codex or Claude Code agent the owner's agent started on a connected machine. */
export interface AgentRecord {
	id: string;
	machineId: string;
	machineName: string;
	rootId: string;
	/** Working folder relative to the root; absent means the root itself. */
	path?: string;
	/** `<root name>/<path>`: where the agent works; the list carries it. */
	folder?: string;
	provider: 'codex' | 'claude';
	title: string;
	conversationId: string;
	remoteStatus?: AgentStatus;
	/** The main chat's tool call that started this agent. */
	toolCallId?: string;
	/** Pending requests and the first one's title, mirrored from the machine. */
	requests?: number;
	requestTitle?: string;
	stalled?: boolean;
	/** First line of the error; written by the coding agent. */
	error?: string;
	/** The latest step as one line; written by the coding agent. */
	activity?: string;
	createdAt: string;
	updatedAt: string;
}

export type TranscriptFile = {
	path: string;
	change: 'add' | 'delete' | 'update' | 'unknown';
	movePath?: string;
};

/** One step of a session: prompts, the agent's messages and its tool work. Text is the agent's, never markup. */
export type TranscriptItem =
	| { kind: 'prompt'; origin?: 'owner' | 'agent'; text: string; at: string }
	| { kind: 'message'; text: string; final?: boolean; at: string }
	| {
			kind: 'command';
			id?: string;
			command: string;
			exitCode?: number;
			outputTail?: string;
			failed?: boolean;
			at: string;
	  }
	| {
			kind: 'tool';
			id?: string;
			name: string;
			detail?: string;
			outputTail?: string;
			failed?: boolean;
			at: string;
	  }
	| { kind: 'fileChange'; files: TranscriptFile[]; more?: number; failed?: boolean; at: string }
	| {
			kind: 'approval';
			requestId: string | number;
			title?: string;
			status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'withdrawn';
			at: string;
	  }
	| { kind: 'turnEnd'; status: AgentStatus; error?: string; at: string };

export interface AgentSession {
	status: AgentStatus;
	attempts: number;
	stalled?: boolean;
	final?: string;
	error?: string;
	deniedTools?: string[];
	requests: AgentRequest[];
	/** The raw tail; a machine without transcripts only has this. */
	output: string;
	transcript?: TranscriptItem[];
}

/** Exactly what an approval allows; `reason` is the provider model's own explanation. */
export interface RequestDetail {
	kind: 'command' | 'writeStdin' | 'fileChange' | 'permissions' | 'question' | 'elicitation';
	command?: string;
	cwd?: string;
	host?: string;
	protocol?: string;
	grantRoot?: string;
	files?: TranscriptFile[];
	diff?: string;
	permissions?: string;
	reason?: string;
}

export interface AgentRequest {
	id: string | number;
	description: string;
	decisions: Decision[];
	detail?: RequestDetail;
}

export interface AgentDetail {
	agent: AgentRecord;
	session?: AgentSession;
	unavailable?: string;
}
