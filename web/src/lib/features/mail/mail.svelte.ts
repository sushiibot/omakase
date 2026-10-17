import { mailApi } from './api';
import type { MailAccount, MailProvider } from './types';
export class MailStore {
	accounts = $state<MailAccount[]>([]);
	providers = $state<MailProvider[]>([]);
	loaded = $state(false);
	busy = $state(false);
	error = $state<string | null>(null);
	notice = $state<string | null>(null);
	async load() {
		this.busy = true;
		this.error = null;
		try {
			const mail = await mailApi.list();
			this.accounts = mail.accounts;
			this.providers = mail.providers;
			this.loaded = true;
		} catch (error) {
			this.error = error instanceof Error ? error.message : 'Could not load accounts. Try again.';
		} finally {
			this.busy = false;
		}
	}
	async save(input: {
		provider: string;
		name: string;
		purpose: string;
		token: string;
		editId?: string;
		reconnectId?: string;
	}) {
		this.busy = true;
		this.error = null;
		this.notice = null;
		try {
			if (input.editId) await mailApi.rename(input.editId, input.name, input.purpose);
			else {
				const provider = this.providers.find((p) => p.id === input.provider);
				if (!provider) throw new Error('Choose a mail provider.');
				const result = await mailApi.connect(provider.id, provider.auth, {
					name: input.name,
					purpose: input.purpose,
					...(provider.auth === 'token' ? { token: input.token } : {}),
					...(input.reconnectId ? { reconnectId: input.reconnectId } : {})
				});
				if (result.url) {
					window.location.assign(result.url);
					return false;
				}
			}
			this.notice = input.editId ? 'Account details saved.' : 'Mail account connected.';
			const list = await mailApi.list();
			this.accounts = list.accounts;
			return true;
		} catch (error) {
			this.error = error instanceof Error ? error.message : 'Could not save the account.';
			return false;
		} finally {
			this.busy = false;
		}
	}
	async remove(id: string) {
		this.busy = true;
		this.error = null;
		this.notice = null;
		try {
			const result = await mailApi.remove(id);
			this.accounts = this.accounts.filter((a) => a.id !== id);
			this.notice = result.message;
		} catch (error) {
			this.error = error instanceof Error ? error.message : 'Could not disconnect the account.';
		} finally {
			this.busy = false;
		}
	}
}
