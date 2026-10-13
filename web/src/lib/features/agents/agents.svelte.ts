import {
	agentsApi,
	type AgentDetail,
	type AgentRecord,
	type AgentsApi,
	type AgentSession,
	type Decision
} from './api';
import { pendingRequests, requestKey } from './model';

let configured: AgentsApi = agentsApi;
export function configureAgents(api: AgentsApi) {
	configured = api;
}

/** One conversation's agents (or every agent), polled while something watches them. */
export class AgentList {
	agents = $state<AgentRecord[]>([]);
	loading = $state(true);
	error = $state<string | null>(null);
	private watchers = 0;
	private timer: ReturnType<typeof setInterval> | undefined;
	constructor(readonly conversationId?: string) {}
	readonly pending = $derived(pendingRequests(this.agents));
	async refresh() {
		try {
			this.agents = (await configured.list(this.conversationId)).agents;
			this.error = null;
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Could not load agents.';
		} finally {
			this.loading = false;
		}
	}
	/** Polls every five seconds while the page is visible; returns the stop function. */
	watch() {
		if (this.watchers++ === 0) {
			void this.refresh();
			this.timer = setInterval(() => {
				if (!document.hidden) void this.refresh();
			}, 5000);
		}
		return () => {
			if (--this.watchers === 0) clearInterval(this.timer);
		};
	}
	/** An agent's newer state from its own read, without waiting for the next poll. */
	merge(agent: AgentRecord) {
		const at = this.agents.findIndex((a) => a.id === agent.id);
		if (at < 0) return;
		const previous = this.agents[at]!;
		this.agents[at] = {
			...previous,
			...agent,
			machineName: previous.machineName,
			folder: previous.folder
		};
	}
}

const lists = new Map<string, AgentList>();
const ALL = '\u0000all';
export function agentList(conversationId?: string): AgentList {
	const key = conversationId ?? ALL;
	let list = lists.get(key);
	if (!list) lists.set(key, (list = new AgentList(conversationId)));
	return list;
}

/** One agent's live detail and the owner's actions on it. */
export class AgentView {
	detail = $state<AgentDetail | null>(null);
	loadError = $state<string | null>(null);
	actionError = $state<string | null>(null);
	busy = $state(false);
	/** The request being answered, so its buttons say so until the machine replies. */
	submitting = $state<string | null>(null);
	constructor(readonly id: string) {}
	get session(): AgentSession | undefined {
		return this.detail?.session;
	}
	async refresh() {
		try {
			this.detail = await configured.get(this.id);
			this.loadError = null;
			for (const list of lists.values()) list.merge(this.detail.agent);
		} catch (err) {
			this.loadError = err instanceof Error ? err.message : 'Could not reach this agent.';
		}
	}
	watch() {
		void this.refresh();
		const timer = setInterval(() => {
			if (!document.hidden && !this.busy) void this.refresh();
		}, 3000);
		return () => clearInterval(timer);
	}
	private async act(run: () => ReturnType<AgentsApi['stop']>, failure: string) {
		this.busy = true;
		this.actionError = null;
		try {
			const { agent, session } = await run();
			if (this.detail)
				this.detail = { ...this.detail, agent: { ...this.detail.agent, ...agent }, session };
			for (const list of lists.values()) list.merge(agent);
			return true;
		} catch (err) {
			this.actionError = err instanceof Error ? err.message : failure;
			return false;
		} finally {
			this.busy = false;
		}
	}
	async answer(requestId: string | number, decision: Decision) {
		this.submitting = requestKey(requestId);
		try {
			return await this.act(
				() => configured.answer(this.id, requestId, decision),
				'Could not answer this approval.'
			);
		} finally {
			this.submitting = null;
		}
	}
	message(text: string) {
		return this.act(() => configured.message(this.id, text), 'Could not send this message.');
	}
	stop() {
		return this.act(() => configured.stop(this.id), 'Could not stop this agent.');
	}
}
