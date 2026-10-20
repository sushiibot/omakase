// Serves Home's fixtures until GET /api/home exists on the bot.
import { fixtureDelay, fixtureScenario } from '$lib/core/fixtures';
import type { HomeMute } from '$lib/core/realtime/events';
import type { HomeApi } from './api';
import { emptyHomeData, homeData } from './fixtures';

export const fixtureHomeApi: HomeApi = {
	async load() {
		const scenario = fixtureScenario('home');
		await fixtureDelay(scenario);
		if (scenario === 'error') throw new Error("The agent's server didn't answer.");
		const now = Date.now();
		if (scenario === 'empty') return emptyHomeData(now);
		if (scenario === 'offline' || scenario === 'unsupported') {
			return { ...emptyHomeData(now), workspace: { state: scenario } };
		}
		return homeData(now);
	},
	async dismiss() {
		await fixtureDelay('normal');
	},
	async restore() {
		await fixtureDelay('normal');
	},
	async opened() {},
	async rate() {
		await fixtureDelay('normal');
	},
	async muted() {
		await fixtureDelay(fixtureScenario('muted'));
		return [...fixtureMutes];
	},
	async unmute(id) {
		await fixtureDelay('normal');
		fixtureMutes = fixtureMutes.filter((m) => m.id !== id);
		return [...fixtureMutes];
	}
};

let fixtureMutes: HomeMute[] = [
	{
		id: 'topic:ci failures',
		scope: 'topic',
		label: 'CI failures',
		job: 'heartbeat',
		at: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString()
	},
	{
		id: 'item:sushii:deploy-reviews',
		scope: 'item',
		label: '6 deployment reviews pending',
		job: 'heartbeat',
		at: new Date(Date.now() - 5 * 60 * 60_000).toISOString()
	}
];
