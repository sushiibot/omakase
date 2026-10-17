import { Capacitor, registerPlugin } from '@capacitor/core';

interface CallAudioPlugin {
	start(): Promise<void>;
	stop(): Promise<void>;
}
const plugin = registerPlugin<CallAudioPlugin>('CallAudio');

export function microphonePermissionHelp(): string {
	return Capacitor.getPlatform() === 'android'
		? 'Allow microphone access in Android Settings → Apps → omakase → Permissions, then try again.'
		: "Allow microphone access in the browser's site settings, then try again.";
}

/** Serialize start/stop so hanging up during native setup cannot leave call mode enabled. */
export class NativeCallAudio {
	private pending: Promise<void> = Promise.resolve();
	constructor(
		private native: CallAudioPlugin = plugin,
		private available = () =>
			Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('CallAudio')
	) {}
	get supported(): boolean {
		return this.available();
	}
	start(): Promise<void> {
		if (!this.available()) return Promise.resolve();
		const next = this.pending.then(() => this.native.start());
		this.pending = next.catch(() => {});
		return next;
	}
	stop(): Promise<void> {
		if (!this.available()) return Promise.resolve();
		const next = this.pending.then(() => this.native.stop());
		this.pending = next.catch(() => {});
		return next;
	}
}
