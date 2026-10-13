import { fixtureDelay, fixtureScenario, type FixtureScenario } from '../../core/fixtures';
import type { AgentsApi } from './api';
import { agentFixtures } from './fixtures';
import type { AgentDetail, TranscriptItem } from './types';

/** The agent routes over fixtures: answering, messaging and stopping move each agent along. */
export function createFixtureAgentsApi(
	scenario: () => FixtureScenario = () => fixtureScenario('agents')
): AgentsApi {
	const details = new Map<string, AgentDetail>();
	for (const d of agentFixtures()) details.set(d.agent.id, d);
	const at = () => new Date().toISOString();
	async function ready() {
		const s = scenario();
		await fixtureDelay(s);
		if (s === 'error' || s === 'offline') throw new Error('The gateway could not be reached.');
		return s;
	}
	function find(id: string) {
		const d = details.get(id);
		if (!d) throw new Error('Agent not found.');
		return d;
	}
	function record(d: AgentDetail, item: TranscriptItem) {
		d.session!.transcript = [...(d.session!.transcript ?? []), item];
	}
	const reply = (d: AgentDetail) => structuredClone({ agent: d.agent, session: d.session! });
	return {
		async list(conversationId) {
			const s = await ready();
			if (s === 'empty') return { agents: [] };
			return {
				agents: [...details.values()]
					.map((d) => structuredClone(d.agent))
					.filter((a) => !conversationId || a.conversationId === conversationId)
			};
		},
		async get(id) {
			await ready();
			return structuredClone(find(id));
		},
		async answer(id, requestId, decision) {
			await fixtureDelay('normal');
			const d = find(id);
			const accepted = decision === 'accept' || decision === 'acceptForSession';
			for (const item of d.session!.transcript ?? [])
				if (item.kind === 'approval' && item.requestId === requestId)
					item.status = accepted ? 'accepted' : decision === 'cancel' ? 'cancelled' : 'declined';
			d.session!.requests = d.session!.requests.filter((r) => r.id !== requestId);
			d.session!.status = 'running';
			Object.assign(d.agent, {
				remoteStatus: 'running',
				requests: undefined,
				requestTitle: undefined,
				updatedAt: at()
			});
			if (accepted) {
				record(d, { kind: 'command', command: 'bun test e2e/logout.test.ts', at: at() });
				setTimeout(() => {
					const items = d.session!.transcript!;
					const last = items[items.length - 1];
					if (last?.kind === 'command') Object.assign(last, { exitCode: 0, outputTail: '3 pass' });
					record(d, {
						kind: 'message',
						final: true,
						text: 'Logout already returns to `/login`; its tests pass.',
						at: at()
					});
					record(d, { kind: 'turnEnd', status: 'completed', at: at() });
					d.session!.status = 'completed';
					Object.assign(d.agent, { remoteStatus: 'completed', updatedAt: at() });
				}, 4000);
			}
			return reply(d);
		},
		async message(id, text) {
			await fixtureDelay('normal');
			const d = find(id);
			if (d.session!.requests.length)
				throw new Error('This session is waiting for an approval. Answer it first.');
			record(d, { kind: 'prompt', origin: 'owner', text, at: at() });
			d.session!.status = 'running';
			Object.assign(d.agent, { remoteStatus: 'running', updatedAt: at() });
			return reply(d);
		},
		async stop(id) {
			await fixtureDelay('normal');
			const d = find(id);
			for (const item of d.session!.transcript ?? [])
				if (item.kind === 'approval' && item.status === 'pending') item.status = 'withdrawn';
			record(d, { kind: 'turnEnd', status: 'stopped', at: at() });
			d.session!.requests = [];
			d.session!.status = 'stopped';
			Object.assign(d.agent, { remoteStatus: 'stopped', requests: undefined, updatedAt: at() });
			return reply(d);
		}
	};
}
