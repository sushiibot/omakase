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
	requests: { id: string | number; description: string; decisions: Decision[] }[];
	output: string;
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

/** Live agents, plus ones that ended in the last day, so a result stays inspectable. */
export function visibleAgents(agents: AgentRecord[], now = Date.now()): AgentRecord[] {
	return agents
		.filter(
			(a) =>
				!a.remoteStatus ||
				a.remoteStatus === 'running' ||
				a.remoteStatus === 'needs-you' ||
				now - Date.parse(a.updatedAt) < 24 * 60 * 60_000
		)
		.slice(0, 5);
}

export function choices(decisions: Decision[]) {
	const approves = decisions.includes('accept');
	return (
		decisions
			// Cancel also ends the provider's turn; Stop covers that.
			.filter((d) => d !== 'cancel' || decisions.length === 1)
			.map((decision) => ({
				decision,
				primary: decision === 'accept',
				label:
					decision === 'accept'
						? 'Approve'
						: decision === 'acceptForSession'
							? 'Approve for this session'
							: decision === 'cancel'
								? 'Cancel request'
								: approves
									? 'Deny'
									: 'Decline'
			}))
	);
}
