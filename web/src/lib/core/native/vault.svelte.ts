import { Capacitor, registerPlugin } from '@capacitor/core';
import { request } from '$lib/core/http';

interface VaultStatus {
	version: number;
	id: string;
	name?: string;
	connected: boolean;
}
interface VaultPlugin {
	status(): Promise<VaultStatus>;
	choose(): Promise<VaultStatus>;
	disconnect(): Promise<void>;
	execute(params: Record<string, unknown>): Promise<unknown>;
}
const plugin = registerPlugin<VaultPlugin>('ObsidianVault');
export const isNativeApp = () => Capacitor.getPlatform() === 'android';

class Vault {
	available = $state(false);
	name = $state<string>();
	connected = $state(false);
	busy = $state(false);
	error = $state<string>();
	private status?: VaultStatus;
	private controller?: AbortController;
	private session?: string;
	private started = false;
	async start() {
		if (this.started || !isNativeApp()) return;
		this.started = true;
		this.available = true;
		document.addEventListener('visibilitychange', () => {
			if (document.hidden) this.stop();
			else void this.resume();
		});
		addEventListener('pagehide', () => this.stop());
		await this.resume();
	}
	private async resume() {
		try {
			this.status = await plugin.status();
			if (this.status.version !== 1)
				throw new Error('Update the Android app to connect your vault.');
			this.name = this.status.name;
			if (this.status.connected && !document.hidden) this.run();
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Could not open the vault.';
		}
	}
	async choose() {
		this.busy = true;
		this.error = undefined;
		this.stop();
		try {
			this.status = await plugin.choose();
			this.name = this.status.name;
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Could not select the folder.';
		} finally {
			this.busy = false;
			await this.resume();
		}
	}
	async disconnect() {
		this.busy = true;
		this.stop();
		try {
			await plugin.disconnect();
			this.status = undefined;
			this.name = undefined;
			this.error = undefined;
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Could not disconnect.';
		} finally {
			this.busy = false;
		}
	}
	private stop() {
		this.controller?.abort();
		this.controller = undefined;
		this.connected = false;
		if (this.session) {
			void fetch('/api/machines/phone/disconnect', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ session: this.session }),
				keepalive: true
			}).catch(() => {});
			this.session = undefined;
		}
	}
	private run() {
		if (this.controller || this.busy || !this.status?.connected) return;
		const controller = new AbortController();
		this.controller = controller;
		void this.loop(controller).finally(() => {
			if (this.controller === controller) {
				this.controller = undefined;
				this.connected = false;
			}
		});
	}
	private async loop(controller: AbortController) {
		const signal = controller.signal;
		while (!signal.aborted) {
			let session: string | undefined;
			try {
				const result = await request<{ session: string }>(
					'POST',
					'/machines/phone/connect',
					{ id: this.status!.id, name: this.status!.name ?? 'Obsidian vault' },
					{ signal }
				);
				session = result.session;
				if (signal.aborted) break;
				this.session = session;
				this.connected = true;
				this.error = undefined;
				while (!signal.aborted) {
					const batch = await request<{
						requests: { id: string; params: Record<string, unknown> }[];
					}>('POST', '/machines/phone/poll', { session }, { signal });
					for (const call of batch.requests) {
						if (signal.aborted) break;
						let result: unknown;
						let error: string | undefined;
						try {
							result = await plugin.execute(call.params);
						} catch (e) {
							error = (e instanceof Error ? e.message : 'Vault operation failed.').slice(0, 1000);
						}
						// Never repeat native operations if delivering their response fails.
						await request(
							'POST',
							'/machines/phone/result',
							{ session, id: call.id, result, error },
							{ signal }
						);
					}
				}
			} catch (e) {
				if (signal.aborted) break;
				this.connected = false;
				this.error = e instanceof Error ? e.message : 'Connection lost. Retrying…';
				await new Promise<void>((resolve) => {
					const done = () => {
						clearTimeout(timer);
						signal.removeEventListener('abort', done);
						resolve();
					};
					const timer = setTimeout(done, 5000);
					signal.addEventListener('abort', done, { once: true });
				});
			} finally {
				if (session)
					void fetch('/api/machines/phone/disconnect', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ session }),
						keepalive: true
					}).catch(() => {});
			}
		}
	}
}
export const vault = new Vault();
