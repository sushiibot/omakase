import { api, type Me } from '$lib/core/api';
import {
	currentPushStatus,
	disablePush,
	enablePush,
	PushSetupError,
	watchPermission,
	type PushStatus
} from '$lib/core/pwa/push';
import { pwa } from '$lib/core/pwa/pwa.svelte';
import { applyTheme, readTheme, type ThemeChoice } from '$lib/core/pwa/theme';
import { Remote } from '$lib/core/remote.svelte';
import { httpSettingsApi, type SettingsApi } from './api';
import type { OwnerName } from './types';

const errorText = (err: unknown) =>
	err instanceof Error ? err.message : 'Something went wrong. Try again.';

export type NameSave = 'idle' | 'saving' | 'saved' | 'failed';

export class SettingsStore {
	me = new Remote<Me>(() => api.me());
	ownerName: Remote<OwnerName>;
	nameSave = $state<NameSave>('idle');
	nameError = $state<string | null>(null);
	push = $state<PushStatus | 'checking'>('checking');
	pushBusy = $state(false);
	pushError = $state<string | null>(null);
	testBusy = $state(false);
	testResult = $state<{ ok: boolean; text: string } | null>(null);
	theme = $state<ThemeChoice>('system');
	installFailed = $state(false);

	#settings: SettingsApi;

	constructor(settings: SettingsApi = httpSettingsApi) {
		this.#settings = settings;
		this.ownerName = new Remote(() => settings.ownerName());
	}

	/** Loads everything the screen shows; returns the cleanup for when it leaves. */
	open(): () => void {
		this.push = 'checking';
		this.pushError = null;
		this.testResult = null;
		this.installFailed = false;
		this.nameSave = 'idle';
		this.nameError = null;
		this.theme = readTheme();
		void this.me.refetch();
		void this.ownerName.refetch();
		void this.#loadPush();
		return watchPermission(() => void this.#refreshPush());
	}

	async #loadPush() {
		try {
			this.push = await currentPushStatus();
		} catch (err) {
			this.push = 'unavailable';
			this.pushError = errorText(err);
		}
	}

	// Coming back from Android settings, or a permission change, updates the switch in place.
	async #refreshPush() {
		if (this.pushBusy) return;
		const wasBlocked = this.push === 'blocked';
		try {
			const next = await currentPushStatus();
			if (this.pushBusy) return;
			this.push = next;
			if (wasBlocked && next !== 'blocked') this.pushError = null;
		} catch {
			// Keep the last known state; the next visit checks again.
		}
	}

	async togglePush() {
		if (this.pushBusy) return;
		this.pushBusy = true;
		this.pushError = null;
		this.testResult = null;
		try {
			if (this.push === 'on') {
				await disablePush();
				this.push = 'off';
			} else {
				await enablePush();
				this.push = 'on';
			}
			pwa.markPushSynced();
		} catch (err) {
			if (err instanceof PushSetupError) this.push = err.status;
			this.pushError = errorText(err);
		} finally {
			this.pushBusy = false;
		}
	}

	async sendTest() {
		this.testBusy = true;
		this.testResult = null;
		try {
			const { sent, pruned } = await api.testPush();
			const devices = sent === 1 ? '1 device' : `${sent} devices`;
			const expired = pruned ? ` Removed ${pruned} expired.` : '';
			this.testResult = {
				ok: sent > 0,
				text:
					sent > 0
						? `Sent to ${devices}.${expired}`
						: `No device received it.${expired} Turn notifications off and on again.`
			};
		} catch (err) {
			this.testResult = { ok: false, text: errorText(err) };
		} finally {
			this.testBusy = false;
		}
	}

	/** Saves the name the agent calls the owner; null or blank clears it. */
	async saveName(name: string | null) {
		if (this.nameSave === 'saving') return;
		this.nameSave = 'saving';
		this.nameError = null;
		try {
			this.ownerName.data = await this.#settings.setOwnerName(name?.trim() || null);
			this.nameSave = 'saved';
		} catch (err) {
			this.nameError = errorText(err);
			this.nameSave = 'failed';
		}
	}

	chooseTheme(choice: ThemeChoice) {
		this.theme = choice;
		applyTheme(choice);
	}

	async install() {
		this.installFailed = (await pwa.install()) === 'failed';
	}
}

let store: SettingsStore | null = null;
let configured: SettingsApi | undefined;

export function configureSettings(api: SettingsApi) {
	configured = api;
}

export function settingsStore(): SettingsStore {
	return (store ??= new SettingsStore(configured));
}
