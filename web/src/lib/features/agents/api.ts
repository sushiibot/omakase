import { request } from '$lib/core/http';
import type { AgentDetail, AgentRecord, AgentSession, Decision } from './types';

export type * from './types';

export interface AgentsApi {
	/** Without a conversation, every agent. */
	list(conversationId?: string): Promise<{ agents: AgentRecord[] }>;
	get(id: string): Promise<AgentDetail>;
	answer(
		id: string,
		requestId: string | number,
		decision: Decision
	): Promise<{ agent: AgentRecord; session: AgentSession }>;
	message(id: string, text: string): Promise<{ agent: AgentRecord; session: AgentSession }>;
	stop(id: string): Promise<{ agent: AgentRecord; session: AgentSession }>;
}

export const agentsApi: AgentsApi = {
	list: (conversationId) =>
		request(
			'GET',
			conversationId ? `/agents?conversationId=${encodeURIComponent(conversationId)}` : '/agents'
		),
	get: (id) => request('GET', `/agents/${encodeURIComponent(id)}`),
	answer: (id, requestId, decision) =>
		request('POST', `/agents/${encodeURIComponent(id)}/answer`, { requestId, decision }),
	message: (id, text) => request('POST', `/agents/${encodeURIComponent(id)}/message`, { text }),
	stop: (id) => request('POST', `/agents/${encodeURIComponent(id)}/stop`, {})
};
