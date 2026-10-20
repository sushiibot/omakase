// Serves the saved-item fixtures for `bun dev ?fake` and the browser tests. Pin and archive last
// until reload.
import { fixtureDelay, fixtureScenario, type FixtureScenario } from '../../core/fixtures';
import type { SavedApi } from './api';
import { savedDocuments, savedItems } from './fixtures';
import type { SavedAction, SavedItem } from './types';

function failure(scenario: string): Error | null {
	if (scenario === 'error') return new Error("The agent's server didn't answer.");
	if (scenario === 'offline') return new Error("Can't reach the agent right now.");
	if (scenario === 'unsupported') return new Error("Saved items aren't available yet.");
	return null;
}

function applied(item: SavedItem, action: SavedAction): SavedItem {
	switch (action) {
		case 'pin':
			return { ...item, pinned: true, archived: false, status: 'active' };
		case 'unpin':
			return { ...item, pinned: false };
		case 'archive':
			return { ...item, pinned: false, archived: true, status: 'done' };
		case 'restore':
			return { ...item, archived: false, status: 'active' };
		default:
			return item;
	}
}

export function createFixtureSavedApi(
	pick: () => FixtureScenario = () => fixtureScenario('saved')
): SavedApi {
	const changed = new Map<string, SavedItem>();
	const all = () =>
		savedItems(Date.now())
			.map((i) => changed.get(i.id) ?? i)
			.sort((a, b) => Number(b.pinned) - Number(a.pinned));
	async function gate() {
		const scenario = pick();
		await fixtureDelay(scenario);
		const err = failure(scenario);
		if (err) throw err;
		return scenario;
	}
	return {
		async list(filter) {
			if ((await gate()) === 'empty') return { items: [] };
			const q = filter.query?.trim().toLowerCase() ?? '';
			const docs = savedDocuments(Date.now());
			const items = all().filter(
				(i) =>
					(!filter.status || filter.status === 'all' || i.status === filter.status) &&
					(!filter.kind || i.kind === filter.kind) &&
					(!filter.conversationId || i.conversationId === filter.conversationId) &&
					(filter.pinned === undefined || i.pinned === filter.pinned) &&
					(!q ||
						`${i.title}\n${i.summary}\n${docs.find((d) => d.id === i.id)?.content ?? ''}`
							.toLowerCase()
							.includes(q))
			);
			return { items };
		},
		async get(id) {
			await gate();
			return all().find((i) => i.id === id) ?? null;
		},
		async act(id, action) {
			await gate();
			const item = all().find((i) => i.id === id);
			if (!item) throw new Error('This item no longer exists.');
			const next = applied(item, action);
			changed.set(id, next);
			return next;
		},
		async document(id) {
			await gate();
			return savedDocuments(Date.now()).find((d) => d.id === id) ?? null;
		}
	};
}
