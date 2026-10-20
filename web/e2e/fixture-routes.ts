import { createFixtureChannelsApi } from '../src/lib/features/channels/fake';
import { createFixtureTasksApi } from '../src/lib/features/tasks/fake';
// The routes the not-yet-built backends will serve (threads, memory, skills, schedules, browser,
// briefing, connectors), answered by each feature's fixture API, as the app build never holds them.
import type { BrowserContext, Route } from '@playwright/test';
import type { FixtureScenario } from '../src/lib/core/fixtures';
import { createFixtureBriefingApi } from '../src/lib/features/briefing/fake';
import { createFixtureBrowserApi } from '../src/lib/features/browser/fake';
import { createFixtureConnectorsApi } from '../src/lib/features/connectors/fake';
import { createFixtureMemoryApi } from '../src/lib/features/memory/fake';
import { createFixtureSchedulesApi } from '../src/lib/features/schedules/fake';
import { createFixtureSkillsApi } from '../src/lib/features/skills/fake';
import { createFixtureThreadsApi } from '../src/lib/features/threads/fake';
import { createFixtureSavedApi } from '../src/lib/features/saved/fake';
import { savedBlocks } from '../src/lib/features/saved/fixtures';
import type { SavedAction, SavedKind } from '../src/lib/features/saved/types';
import { applyLiveOps } from '../src/lib/features/chat/render/rich/live';
import type { LiveBlock, LiveBlockOp } from '../src/lib/core/realtime/events';

export type FixtureFeature =
	'threads' | 'memory' | 'skills' | 'schedules' | 'browser' | 'briefing' | 'connectors' | 'saved';

export interface FixtureRoutes {
	set(feature: FixtureFeature, scenario: FixtureScenario): void;
}

const STATUS: Partial<Record<FixtureScenario, number>> = {
	error: 500,
	offline: 503,
	unsupported: 501
};

export async function fixtureRoutes(
	context: BrowserContext,
	initial: Partial<Record<FixtureFeature, FixtureScenario>> = {}
): Promise<FixtureRoutes> {
	const scenarios: Record<string, FixtureScenario> = { ...initial };
	const pick = (f: FixtureFeature) => () => scenarios[f] ?? 'normal';
	const tasks = createFixtureTasksApi();
	const threads = createFixtureThreadsApi(pick('threads'));
	const channels = createFixtureChannelsApi({ threads, tasks });
	const memory = createFixtureMemoryApi(pick('memory'));
	const skills = createFixtureSkillsApi(pick('skills'));
	const schedules = createFixtureSchedulesApi(pick('schedules'));
	const browser = createFixtureBrowserApi(pick('browser'));
	const briefing = createFixtureBriefingApi(pick('briefing'));
	const connectors = createFixtureConnectorsApi(pick('connectors'));
	const saved = createFixtureSavedApi(pick('saved'));
	// The saved checklists, recipes and timers as stored blocks, changed by POST /api/blocks.
	const blocks = new Map<string, LiveBlock>(savedBlocks(Date.now()).map((b) => [b.id, b]));

	const answer = async (route: Route, feature: FixtureFeature, run: () => Promise<unknown>) => {
		try {
			const data = await run();
			// No such item; the briefing alone answers null for "none yet today".
			if (data === null && feature !== 'briefing')
				return route.fulfill({ status: 404, json: { error: 'not found' } });
			if (data === undefined) return route.fulfill({ status: 204 });
			return route.fulfill({ json: data });
		} catch (err) {
			const status = STATUS[scenarios[feature] ?? 'normal'] ?? 422;
			return route.fulfill({
				status,
				json: { error: err instanceof Error ? err.message : 'failed' }
			});
		}
	};

	await context.route('**/api/**', async (route) => {
		const req = route.request();
		const path = new URL(req.url()).pathname.slice('/api'.length);
		const body = (req.postData() ? JSON.parse(req.postData()!) : {}) as Record<string, never>;
		const post = req.method() === 'POST';
		const m = (re: RegExp) => re.exec(path);
		let hit: RegExpExecArray | null;

		if (path === '/maintenance')
			return route.fulfill({
				json: {
					view: {
						responsibility: {
							title: 'Keep upcoming plans accurate',
							enabled: true,
							lastReadAt: null,
							lastReviewAt: null,
							lastError: null
						},
						proposals: []
					}
				}
			});
		if (path === '/machines') return route.fulfill({ json: { machines: [] } });
		if (path.startsWith('/agents')) return route.fulfill({ json: { agents: [] } });
		if (path === '/tasks')
			return route.fulfill({ json: await (post ? tasks.action(body) : tasks.list()) });
		if ((hit = m(/^\/tasks\/([^/]+)\/chat\/(.*)$/))) {
			if (hit[2] === 'history') return route.fulfill({ json: { items: [], before: null } });
			if (hit[2] === 'stream')
				return route.fulfill({
					contentType: 'text/event-stream',
					body: `event: hello\ndata: ${JSON.stringify({ headSeq: 0, workspace: 'online', openTurns: [], pending: { approvals: [], asks: [] } })}\n\n`
				});
			if (hit[2] === 'messages')
				return route.fulfill({ status: 202, json: { seq: 1, routed: true } });
			return route.fulfill({ status: 204 });
		}
		if ((hit = m(/^\/threads\/([^/]+)\/chat\/(.*)$/))) {
			const id = hit[1];
			const sub = hit[2];
			if (sub === 'history')
				return answer(route, 'threads', async () => ({
					items: (await threads.get(id))?.history ?? [],
					before: null
				}));
			if (sub === 'stream')
				return route.fulfill({
					contentType: 'text/event-stream',
					body: `event: hello\ndata: ${JSON.stringify({ headSeq: 0, workspace: 'online', openTurns: [], pending: { approvals: [], asks: [] } })}\n\n`
				});
			if (sub === 'messages') return route.fulfill({ status: 202, json: { seq: 1, routed: true } });
			return route.fulfill({ status: 204 });
		}
		if (path === '/saved') {
			const q = new URL(req.url()).searchParams;
			if (post)
				return answer(route, 'saved', async () => ({
					items: [await saved.act(body.id, body.action as SavedAction)]
				}));
			if (q.get('id'))
				return answer(route, 'saved', async () => {
					const item = await saved.get(q.get('id')!);
					return item ? { items: [item] } : null;
				});
			return answer(route, 'saved', () =>
				saved.list({
					status: (q.get('status') as 'active' | 'done' | 'all' | null) ?? 'active',
					...(q.get('kind') ? { kind: q.get('kind') as SavedKind } : {}),
					...(q.get('conversation') ? { conversationId: q.get('conversation')! } : {}),
					...(q.get('pinned') ? { pinned: q.get('pinned') === '1' } : {}),
					...(q.get('q') ? { query: q.get('q')! } : {})
				})
			);
		}
		if ((hit = m(/^\/artifacts\/([0-9a-f-]{36})$/)))
			return answer(route, 'saved', () => saved.document(hit![1]));
		if (path === '/blocks') {
			if (post) {
				const current = blocks.get(body.id);
				if (!current) return route.fulfill({ status: 404, json: { error: 'gone' } });
				const result = applyLiveOps(current, body.ops as LiveBlockOp[], 'owner', new Date());
				if (!result.ok) return route.fulfill({ status: 409, json: { error: result.error } });
				blocks.set(result.block.id, result.block);
				return route.fulfill({ json: { blocks: [result.block] } });
			}
			const keys = (new URL(req.url()).searchParams.get('keys') ?? '').split(',');
			return route.fulfill({
				json: { blocks: [...blocks.values()].filter((b) => keys.includes(b.messageKey)) }
			});
		}
		if (path === '/channels') return answer(route, 'threads', () => channels.list());
		if (path === '/chats') return answer(route, 'threads', () => threads.list());
		if (path === '/threads' && post) return answer(route, 'threads', () => threads.branch(body));
		if ((hit = m(/^\/threads\/([^/]+)\/(close|reopen|rename)$/)))
			return answer(route, 'threads', () =>
				hit![2] === 'rename'
					? threads.rename(hit![1], body.title)
					: hit![2] === 'close'
						? threads.close(hit![1])
						: threads.reopen(hit![1])
			);
		if ((hit = m(/^\/threads\/([^/]+)$/)))
			return answer(route, 'threads', () => threads.get(decodeURIComponent(hit![1])));

		if (path === '/memory') return answer(route, 'memory', () => memory.overview());
		if ((hit = m(/^\/memory\/files\/([^/]+)$/)))
			return answer(route, 'memory', () => memory.file(hit![1]));
		if ((hit = m(/^\/memory\/writes\/([^/]+)\/(revert|restore)$/)))
			return answer(route, 'memory', () =>
				hit![2] === 'revert' ? memory.revert(hit![1]) : memory.restore(hit![1])
			);
		if ((hit = m(/^\/memory\/writes\/([^/]+)$/)))
			return answer(route, 'memory', () => memory.write(hit![1]));

		if (path === '/skills') return answer(route, 'skills', () => skills.list());
		if ((hit = m(/^\/skills\/([^/]+)\/stage$/)))
			return answer(route, 'skills', () => skills.setStage(hit![1], body.stage));
		if ((hit = m(/^\/skills\/([^/]+)$/))) return answer(route, 'skills', () => skills.get(hit![1]));

		if (path === '/schedules') return answer(route, 'schedules', () => schedules.list());
		if ((hit = m(/^\/schedules\/([^/]+)\/enabled$/)))
			return answer(route, 'schedules', () => schedules.setEnabled(hit![1], body.enabled));
		if ((hit = m(/^\/schedules\/([^/]+)\/test$/)))
			return answer(route, 'schedules', () => schedules.testRun(hit![1], () => {}));
		if ((hit = m(/^\/schedules\/([^/]+)$/)))
			return answer(route, 'schedules', () => schedules.get(hit![1]));

		if (path === '/browser') return answer(route, 'browser', () => browser.status());
		if (path === '/browser/takeover') return answer(route, 'browser', () => browser.takeOver());
		if (path === '/browser/handback') return answer(route, 'browser', () => browser.handBack());

		if (path === '/briefing') return answer(route, 'briefing', () => briefing.today());
		if ((hit = m(/^\/briefing\/items\/([^/]+)\/(vote|dismiss)$/)))
			return answer(route, 'briefing', () =>
				hit![2] === 'vote'
					? briefing.vote(hit![1], body.vote)
					: briefing.dismiss(hit![1], body.dismissed)
			);

		if (path === '/connectors') return answer(route, 'connectors', () => connectors.list());
		if (path === '/connectors/begin')
			return answer(route, 'connectors', () => connectors.begin(body.url, body.token));
		if (path === '/connectors/finish')
			return answer(route, 'connectors', () => connectors.finish(body.url, body.redirect));
		if ((hit = m(/^\/connectors\/([^/]+)\/(reconnect|disconnect|remove)$/)))
			return answer(route, 'connectors', () =>
				connectors.action!(hit![1], hit![2] as 'reconnect' | 'disconnect' | 'remove')
			);
		if ((hit = m(/^\/connectors\/([^/]+)\/accept$/)))
			return answer(route, 'connectors', () => connectors.acceptTools(hit![1]));
		if ((hit = m(/^\/connectors\/([^/]+)$/)))
			return answer(route, 'connectors', () => connectors.get(hit![1]));

		return route.fallback();
	});
	return { set: (f, s) => void (scenarios[f] = s) };
}
