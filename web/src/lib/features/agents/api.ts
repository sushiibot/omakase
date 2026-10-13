import { request } from '$lib/core/http';

export type AgentStatus =
	'running' | 'needs-you' | 'completed' | 'failed' | 'stopped' | 'interrupted';
export type Decision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';

/** A Codex or Claude Code agent the owner's agent started on a connected machine. */
export interface AgentRecord {
	id: string;
	machineId: string;
	machineName: string;
	rootId: string;
	provider: 'codex' | 'claude';
	title: string;
	conversationId: string;
	remoteStatus?: AgentStatus;
	createdAt: string;
	updatedAt: string;
}

export interface AgentSession {
	status: AgentStatus;
	attempts: number;
	stalled?: boolean;
	final?: string;
	error?: string;
	deniedTools?: string[];
	requests: AgentRequest[];
	output: string;
}

/** Exactly what an approval allows; `reason` is the provider model's own explanation. */
export interface RequestDetail {
	kind: 'command' | 'writeStdin' | 'fileChange' | 'permissions' | 'question' | 'elicitation';
	command?: string;
	cwd?: string;
	host?: string;
	protocol?: string;
	grantRoot?: string;
	files?: { path: string; change: string }[];
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

export interface AgentsApi {
	list(conversationId: string): Promise<{ agents: AgentRecord[] }>;
	get(id: string): Promise<{ agent: AgentRecord; session?: AgentSession; unavailable?: string }>;
	answer(
		id: string,
		requestId: string | number,
		decision: Decision
	): Promise<{ session: AgentSession }>;
	message(id: string, text: string): Promise<{ session: AgentSession }>;
	stop(id: string): Promise<{ session: AgentSession }>;
}

export const agentsApi: AgentsApi = {
	list: (conversationId) =>
		request('GET', `/agents?conversationId=${encodeURIComponent(conversationId)}`),
	get: (id) => request('GET', `/agents/${encodeURIComponent(id)}`),
	answer: (id, requestId, decision) =>
		request('POST', `/agents/${encodeURIComponent(id)}/answer`, { requestId, decision }),
	message: (id, text) => request('POST', `/agents/${encodeURIComponent(id)}/message`, { text }),
	stop: (id) => request('POST', `/agents/${encodeURIComponent(id)}/stop`, {})
};

export function agentName(a: Pick<AgentRecord, 'provider' | 'machineName'>): string {
	return `${a.provider === 'codex' ? 'Codex' : 'Claude Code'} agent on ${a.machineName}`;
}

const LIVE_ORDER: Record<string, number> = { 'needs-you': 0, running: 1 };

/** Agents waiting on the owner, then running ones, always; up to five that ended in the last day after them. */
export function visibleAgents(agents: AgentRecord[], now = Date.now()): AgentRecord[] {
	const live = agents
		.filter((a) => !a.remoteStatus || a.remoteStatus in LIVE_ORDER)
		.sort(
			(a, b) => LIVE_ORDER[a.remoteStatus ?? 'running']! - LIVE_ORDER[b.remoteStatus ?? 'running']!
		);
	const recent = agents
		.filter(
			(a) =>
				a.remoteStatus &&
				!(a.remoteStatus in LIVE_ORDER) &&
				now - Date.parse(a.updatedAt) < 24 * 60 * 60_000
		)
		.slice(0, 5);
	return [...live, ...recent];
}

/** A key no two request ids share, whatever their JSON type. */
export const requestKey = (id: string | number) => `${typeof id}:${id}`;

const KIND_LABEL: Record<RequestDetail['kind'], string> = {
	command: 'Run a command',
	writeStdin: 'Write to a running terminal',
	fileChange: 'Change files',
	permissions: 'Grant permissions',
	question: 'Answer a question',
	elicitation: 'Give input to a tool'
};

/** The heading and the exact thing being approved, shown in full. */
export function requestView(r: AgentRequest): { title: string; exact?: string } {
	const d = r.detail;
	if (!d) return { title: 'Approval needed' };
	const title =
		d.host && d.kind === 'command' && !d.command ? 'Network access' : KIND_LABEL[d.kind];
	const exact = [
		d.host ? `${d.protocol ? `${d.protocol} ` : ''}${d.host}` : '',
		d.command ?? '',
		d.grantRoot ? `Write access: ${d.grantRoot}` : '',
		d.files?.map((f) => `${f.change} ${f.path}`).join('\n') ?? '',
		d.diff ?? '',
		d.permissions ?? ''
	]
		.filter(Boolean)
		.join('\n');
	return { title, ...(exact ? { exact } : {}) };
}

/** Decision buttons. Approve-for-this-turn is a separate switch, and cancel is Stop's job. */
export function choices(decisions: Decision[]) {
	const approves = decisions.includes('accept');
	return decisions
		.filter((d) => d !== 'acceptForSession' && (d !== 'cancel' || decisions.length === 1))
		.map((decision) => ({
			decision,
			primary: decision === 'accept',
			label:
				decision === 'accept'
					? 'Approve'
					: decision === 'cancel'
						? 'Cancel request'
						: approves
							? 'Deny'
							: 'Decline'
		}));
}
