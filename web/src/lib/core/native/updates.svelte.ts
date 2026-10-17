import { Capacitor, registerPlugin } from '@capacitor/core';
import type { AndroidRelease } from '$lib/core/realtime/events';
import { isNativeApp } from './device-fs.svelte';

interface UpdatePlugin {
	status(): Promise<{ versionCode: number; versionName: string }>;
	install(release: AndroidRelease): Promise<{ permissionRequired?: boolean } | void>;
}
const plugin = registerPlugin<UpdatePlugin>('AppUpdates');
class AndroidUpdates {
	release = $state<AndroidRelease | null>(null);
	installed = $state<number | null>(null);
	busy = $state(false);
	error = $state<string | null>(null);
	permissionRequired = $state(false);
	get available() {
		return (
			isNativeApp() &&
			this.release !== null &&
			(this.installed === null || this.release.versionCode > this.installed)
		);
	}
	get supported() {
		return Capacitor.isPluginAvailable('AppUpdates');
	}
	async start() {
		if (!isNativeApp() || !this.supported) return;
		try {
			this.installed = (await plugin.status()).versionCode;
		} catch {
			/* Older APKs use the download link. */
		}
	}
	receive(release: AndroidRelease | null) {
		if (
			!release ||
			!Number.isSafeInteger(release.versionCode) ||
			release.url !==
				`https://github.com/sushiibot/omakase/releases/download/android-${release.versionCode}/omakase.apk` ||
			!/^[a-f0-9]{64}$/.test(release.sha256)
		)
			return;
		this.release = release;
	}
	async install() {
		if (!this.release || this.busy) return;
		this.busy = true;
		this.error = null;
		try {
			const result = await plugin.install(this.release);
			this.permissionRequired = !!result?.permissionRequired;
		} catch (error) {
			this.error =
				error instanceof Error
					? error.message
					: 'Could not download the Android update. Try again.';
		} finally {
			this.busy = false;
		}
	}
}
export const androidUpdates = new AndroidUpdates();
