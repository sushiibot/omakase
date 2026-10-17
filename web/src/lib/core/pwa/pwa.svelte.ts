import { isNativeApp } from '$lib/core/native/device-fs.svelte';
import { hub } from '$lib/core/realtime/hub.svelte';
import type { AppVersions } from '$lib/core/realtime/events';
import { androidUpdates } from '$lib/core/native/updates.svelte';
import { dev } from '$app/environment';
import { resyncPush } from './push';
import { serviceWorkerUrl } from './trusted-types';

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
	interface Window {
		__installPrompt?: BeforeInstallPromptEvent;
	}
}

class Pwa {
	online = $state(true);
	standalone = $state(false);
	installPrompt = $state<BeforeInstallPromptEvent | null>(null);
	waiting = $state<ServiceWorker | null>(null);
	swError = $state<string | null>(null);
	/** 'failed' when this device's push subscription couldn't be re-sent to the agent. */
	pushSync = $state<'pending' | 'ok' | 'failed'>('pending');
	updateState = $state<'idle' | 'downloading' | 'ready' | 'failed'>('idle');
	updateError = $state<string | null>(null);
	#target: string | null = null;
	#registration: Promise<ServiceWorkerRegistration | undefined> | undefined;
	#checking: Promise<void> | null = null;
	#preparing: Promise<void> | null = null;
	#lastCheck = 0;
	#started = false;
	#reloadPending = false;
	#syncing: Promise<void> | null = null;

	get canInstall() {
		return !this.standalone && this.installPrompt !== null;
	}

	start() {
		if (this.#started) return;
		this.#started = true;

		this.online = navigator.onLine;
		addEventListener('online', () => {
			this.online = true;
			this.#retryPushSync();
			void this.checkUpdates();
		});
		addEventListener('offline', () => (this.online = false));

		const standalone = matchMedia('(display-mode: standalone)');
		this.standalone = isNativeApp() || standalone.matches;
		standalone.addEventListener('change', (e) => (this.standalone = isNativeApp() || e.matches));

		// app.html captures an early prompt before this module loads.
		this.installPrompt = window.__installPrompt ?? null;
		addEventListener('beforeinstallprompt', (e) => {
			e.preventDefault();
			this.installPrompt = e as BeforeInstallPromptEvent;
		});
		addEventListener('appinstalled', () => (this.installPrompt = null));

		if (!isNativeApp()) this.#registration = this.#registerServiceWorker();
		else if ('serviceWorker' in navigator) {
			void navigator.serviceWorker
				.getRegistrations()
				.then((items) => Promise.all(items.map((item) => item.unregister())))
				.catch(() => {});
		}
		hub.subscribe({ types: ['app_update'] }, (events) => {
			for (const event of events) if (event.type === 'app_update') this.receiveVersions(event.data);
		});
		void androidUpdates.start();
		const foreground = () => {
			if (document.visibilityState === 'visible') void this.checkUpdates();
		};
		document.addEventListener('visibilitychange', foreground);
		setInterval(foreground, 5 * 60_000);
		void this.checkUpdates();
	}

	/** Reconnect announcements bypass throttling; HTTP is only a recovery fallback. */
	receiveVersions(versions: AppVersions) {
		androidUpdates.receive(versions.android);
		if (typeof versions.web !== 'string' || !versions.web || dev) return;
		if (versions.web === __APP_VERSION__) {
			this.#target = null;
			this.updateState = 'idle';
			return;
		}
		const changed = this.#target !== versions.web;
		this.#target = versions.web;
		if (changed || this.updateState === 'failed' || this.updateState === 'idle')
			void this.prepareUpdate();
	}

	checkUpdates(force = false): Promise<void> {
		if (this.#checking) return this.#checking;
		if (!force && Date.now() - this.#lastCheck < 60_000) return Promise.resolve();
		this.#lastCheck = Date.now();
		this.#checking = (async () => {
			try {
				const response = await fetch('/api/updates', {
					cache: 'no-store',
					signal: AbortSignal.timeout(10_000)
				});
				if (response.ok) this.receiveVersions(await response.json());
			} catch {
				/* Reconnect or the next foreground check retries without interrupting chat. */
			}
		})().finally(() => {
			this.#checking = null;
		});
		return this.#checking;
	}

	async prepareUpdate(): Promise<void> {
		if (this.#preparing) return this.#preparing;
		this.updateError = null;
		this.updateState = 'downloading';
		this.#preparing = (async () => {
			try {
				const reg = await this.#registration;
				if (!reg || isNativeApp()) {
					this.updateState = 'ready';
					return;
				}
				await reg.update();
				const worker = reg.installing ?? reg.waiting;
				if (worker && worker.state !== 'installed' && worker.state !== 'activated') {
					await new Promise<void>((resolve, reject) => {
						const done = (error?: Error) => {
							clearTimeout(timeout);
							worker.removeEventListener('statechange', check);
							error ? reject(error) : resolve();
						};
						const check = () => {
							if (worker.state === 'installed' || worker.state === 'activated') done();
							else if (worker.state === 'redundant')
								done(new Error('Update download failed. Try again.'));
						};
						const timeout = setTimeout(
							() => done(new Error('Update download timed out. Try again.')),
							60_000
						);
						worker.addEventListener('statechange', check);
						check();
					});
				}
				this.waiting = reg.waiting;
				this.updateState = this.#target || this.waiting ? 'ready' : 'idle';
			} catch {
				this.updateState = 'failed';
				this.updateError = 'Could not download the web update.';
			}
		})().finally(() => {
			this.#preparing = null;
		});
		return this.#preparing;
	}

	async install(): Promise<'accepted' | 'dismissed' | 'failed'> {
		const prompt = this.installPrompt;
		if (!prompt) return 'failed';
		// A prompt event can only be used once.
		this.installPrompt = null;
		try {
			await prompt.prompt();
			return (await prompt.userChoice).outcome;
		} catch {
			return 'failed';
		}
	}

	/** Activates a waiting worker, then reloads even if controllerchange never arrives. */
	applyUpdate() {
		if (this.#reloadPending) return;
		const worker = this.waiting;
		if (!worker || worker.state === 'activated' || worker.state === 'redundant') {
			location.reload();
			return;
		}
		this.#reloadPending = true;
		const reload = () => {
			if (!this.#reloadPending) return;
			this.#reloadPending = false;
			clearTimeout(timeout);
			worker.removeEventListener('statechange', activated);
			navigator.serviceWorker.removeEventListener('controllerchange', reload);
			location.reload();
		};
		const activated = () => {
			if (worker.state === 'activated' || worker.state === 'redundant') reload();
		};
		// A stale worker must not turn the visible Reload button into a no-op.
		const timeout = setTimeout(reload, 5000);
		worker.addEventListener('statechange', activated);
		navigator.serviceWorker.addEventListener('controllerchange', reload);
		try {
			worker.postMessage({ type: 'SKIP_WAITING' });
		} catch {
			reload();
		}
	}

	/** Applies a waiting update if there is one, otherwise just reloads. */
	reload() {
		this.applyUpdate();
	}

	/** Re-sends the push subscription; concurrent callers share one attempt. */
	syncPush(): Promise<void> {
		this.#syncing ??= resyncPush()
			.then(() => {
				this.pushSync = 'ok';
			})
			.catch((err) => {
				this.pushSync = 'failed';
				console.warn('Could not re-send the push subscription', err);
			})
			.finally(() => {
				this.#syncing = null;
			});
		return this.#syncing;
	}

	/** Marks the subscription as in step after the user turned notifications on or off. */
	markPushSynced() {
		this.pushSync = 'ok';
	}

	#retryPushSync() {
		if (this.pushSync === 'failed') void this.syncPush();
	}

	async #registerServiceWorker() {
		if (!('serviceWorker' in navigator)) return;
		let reg: ServiceWorkerRegistration;
		try {
			reg = await navigator.serviceWorker.register(serviceWorkerUrl(), {
				type: dev ? 'module' : 'classic',
				updateViaCache: 'none'
			});
		} catch (err) {
			this.swError = err instanceof Error ? err.message : String(err);
			return;
		}

		const track = (worker: ServiceWorker | null) => {
			if (!worker) return;
			const check = () => {
				if (worker.state === 'installed' && navigator.serviceWorker.controller) {
					this.waiting = worker;
					this.updateState = 'ready';
				} else if (this.waiting === worker && worker.state === 'redundant') {
					this.waiting = null;
				}
			};
			check();
			worker.addEventListener('statechange', check);
		};
		track(reg.waiting);
		// A navigation can start an update before register() resolves.
		track(reg.installing);
		reg.addEventListener('updatefound', () => track(reg.installing));

		// An installed app can stay open for days; look for a new build whenever it comes back.
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState !== 'visible') return;
			reg.update().catch(() => {});
			this.#retryPushSync();
		});

		void this.syncPush();
		return reg;
	}
}

export const pwa = new Pwa();
