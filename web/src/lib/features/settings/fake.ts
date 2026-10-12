// Serves the owner name for `bun dev` with ?fake. A saved name lasts until reload.
import { fixtureDelay, fixtureScenario, type FixtureScenario } from '../../core/fixtures';
import type { SettingsApi } from './api';
import { OWNER_NAME_MAX } from './types';

function failure(scenario: FixtureScenario): Error | null {
	if (scenario === 'error') return new Error("The agent's server didn't answer.");
	if (scenario === 'offline') return new Error("Can't reach the agent right now.");
	if (scenario === 'unsupported') return new Error("This agent version can't save your name yet.");
	return null;
}

export function createFixtureSettingsApi(
	pick: () => FixtureScenario = () => fixtureScenario('settings')
): SettingsApi {
	let name: string | null = 'Sam';
	return {
		async ownerName() {
			const scenario = pick();
			await fixtureDelay(scenario);
			const err = failure(scenario);
			if (err) throw err;
			return { name: scenario === 'empty' ? null : name };
		},
		async setOwnerName(next) {
			const scenario = pick();
			await fixtureDelay(scenario);
			const err = failure(scenario);
			if (err) throw err;
			const trimmed = next?.trim() || null;
			if (trimmed && trimmed.length > OWNER_NAME_MAX) {
				throw new Error(`Use ${OWNER_NAME_MAX} characters or fewer.`);
			}
			name = trimmed;
			return { name };
		}
	};
}
