import type { HomeMute } from '$lib/core/realtime/events';
import { HttpError } from '$lib/core/http';
import type { HomeApi } from './api';
import { homeApi } from './needs-you.svelte';

function errorText(err: unknown, what: string): string {
	const status = err instanceof HttpError ? err.status : 0;
	if (status === 503)
		return `The agent's workspace is offline, so it couldn't ${what}. Try again later.`;
	if (status === 0) return `Couldn't ${what}. Check your connection and try again.`;
	return `The agent couldn't ${what}. Try again.`;
}

/** What the owner muted with 👎 on job items, kept by the workspace. */
export class MutedStore {
	mutes = $state.raw<HomeMute[]>([]);
	loaded = $state(false);
	busy = $state(false);
	error = $state<string | null>(null);
	/** The mute last lifted, for the status line. */
	lifted = $state<string | null>(null);
	#api: HomeApi;

	constructor(api: HomeApi = homeApi()) {
		this.#api = api;
	}

	async load() {
		this.busy = true;
		this.error = null;
		try {
			this.mutes = await this.#api.muted();
			this.loaded = true;
		} catch (err) {
			this.error = errorText(err, 'load your muted topics');
		} finally {
			this.busy = false;
		}
	}

	async unmute(mute: HomeMute) {
		this.busy = true;
		this.error = null;
		this.lifted = null;
		try {
			this.mutes = await this.#api.unmute(mute.id);
			this.lifted = mute.label;
		} catch (err) {
			this.error = errorText(err, 'unmute it');
		} finally {
			this.busy = false;
		}
	}
}
