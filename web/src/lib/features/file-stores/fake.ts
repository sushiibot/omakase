// Serves file-store fixtures for `bun dev` with ?fake. Changes last until reload.
import { fixtureDelay, fixtureScenario, type FixtureScenario } from '../../core/fixtures';
import type { FileStoresApi } from './api';
import type { FileStore } from './types';

function failure(scenario: FixtureScenario): Error | null {
	if (scenario === 'error') return new Error("The agent's server didn't answer.");
	if (scenario === 'offline') return new Error("Can't reach the agent right now.");
	if (scenario === 'unsupported') return new Error("File stores aren't available yet.");
	return null;
}

const seed = (): FileStore[] => [
	{
		id: 'home-nas',
		revision: 3,
		name: 'Home NAS',
		endpoint: 'https://nas.home.example:5006',
		folders: [
			{ id: 'f-docs', path: '/Documents', writable: false },
			{ id: 'f-scans', path: '/Scans/Inbox', writable: true }
		],
		username: 'sushii',
		certificateSha256: '',
		enabled: true
	},
	{
		id: 'office',
		revision: 1,
		name: 'Office share',
		endpoint: 'https://files.office.example',
		folders: [{ id: 'f-shared', path: '/Shared/Receipts', writable: false }],
		username: 'assistant',
		certificateSha256: '',
		enabled: false
	}
];

export function createFixtureFileStoresApi(
	pick: () => FixtureScenario = () => fixtureScenario('file-stores')
): FileStoresApi {
	let stores = seed();
	async function gate() {
		const scenario = pick();
		await fixtureDelay(scenario);
		const err = failure(scenario);
		if (err) throw err;
		return scenario;
	}
	return {
		async list() {
			return { stores: (await gate()) === 'empty' ? [] : stores };
		},
		async save(input) {
			await gate();
			const { password: _password, ...fields } = input;
			const previous = stores.find((s) => s.id === input.id);
			const store: FileStore = {
				...fields,
				id: input.id ?? `store-${crypto.randomUUID()}`,
				revision: (previous?.revision ?? 0) + 1
			};
			stores = [...stores.filter((s) => s.id !== store.id), store];
			return { store };
		},
		async test(id) {
			await gate();
			const store = stores.find((s) => s.id === id);
			if (!store) return { ok: false, message: 'This connection no longer exists.' };
			return {
				ok: true,
				message: 'Connected. Every folder is reachable.',
				folders: store.folders.map((f) => ({
					path: f.path,
					ok: true,
					message: f.writable ? 'Read and write' : 'Read only'
				}))
			};
		},
		async remove(store) {
			await gate();
			stores = stores.filter((s) => s.id !== store.id);
			return { removed: true };
		}
	};
}
