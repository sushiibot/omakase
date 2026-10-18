import { accountsApi } from './api';
import type { Account, AuditEvent } from './types';

export function createAccounts() {
	let accounts = $state<Account[]>([]);
	let loading = $state(true);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let notice = $state<string | null>(null);
	let secret = $state<{ id: string; password: string; version: number } | null>(null);
	let historyId = $state<string | null>(null);
	let events = $state<AuditEvent[]>([]);
	let historyLoading = $state(false);
	let historyError = $state(false);
	const lifetime = new AbortController();
	let sensitive = new AbortController();
	let epoch = 0;
	let historyEpoch = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	function hide() {
		epoch++;
		sensitive.abort();
		sensitive = new AbortController();
		clearTimeout(timer);
		secret = null;
	}
	async function refresh() {
		if (loading && accounts.length) return;
		hide();
		loading = true;
		error = null;
		try {
			accounts = (await accountsApi.list(lifetime.signal)).accounts;
		} catch {
			if (!lifetime.signal.aborted) error = 'Could not load accounts. Try refreshing.';
		} finally {
			loading = false;
		}
	}
	async function history(id: string) {
		const generation = ++historyEpoch;
		historyId = id;
		events = [];
		historyLoading = true;
		historyError = false;
		try {
			const result = await accountsApi.audit(id, lifetime.signal);
			if (generation === historyEpoch && !lifetime.signal.aborted) events = result.events;
		} catch {
			if (generation === historyEpoch) historyError = true;
		} finally {
			if (generation === historyEpoch) historyLoading = false;
		}
	}
	async function reveal(account: Account, purpose: 'reveal' | 'copy', version = account.version) {
		if (busy) return;
		hide();
		const generation = epoch;
		busy = true;
		error = null;
		notice = null;
		try {
			const result = await accountsApi.reveal(account.id, version, purpose, sensitive.signal);
			if (generation !== epoch || lifetime.signal.aborted) return;
			if (typeof result.password !== 'string' || result.version !== version) throw new Error();
			if (purpose === 'copy') {
				await navigator.clipboard.writeText(result.password);
				if (generation === epoch)
					notice = 'Password copied. Your clipboard keeps it until you replace it.';
			} else {
				secret = { id: account.id, ...result };
				timer = setTimeout(hide, 30_000);
			}
			if (historyId === account.id) void history(account.id);
		} catch {
			if (generation === epoch && !lifetime.signal.aborted)
				error =
					purpose === 'copy'
						? 'Could not copy the password. Try again, or reveal it and copy manually.'
						: 'Could not reveal the password. Refresh the account and try again.';
		} finally {
			busy = false;
		}
	}
	async function archive(account: Account) {
		if (busy) return;
		hide();
		busy = true;
		error = null;
		notice = null;
		try {
			const result = await accountsApi.archive(account, lifetime.signal);
			accounts = accounts.map((a) => (a.id === account.id ? result.account : a));
			notice = 'Account archived. This does not delete the account on the website.';
			if (historyId === account.id) void history(account.id);
		} catch {
			if (!lifetime.signal.aborted) error = 'Could not archive the account. Refresh and try again.';
		} finally {
			busy = false;
		}
	}
	return {
		get accounts() {
			return accounts;
		},
		get loading() {
			return loading;
		},
		get busy() {
			return busy;
		},
		get error() {
			return error;
		},
		get notice() {
			return notice;
		},
		get secret() {
			return secret;
		},
		get historyId() {
			return historyId;
		},
		get events() {
			return events;
		},
		get historyLoading() {
			return historyLoading;
		},
		get historyError() {
			return historyError;
		},
		refresh,
		reveal,
		hide,
		archive,
		history,
		closeHistory() {
			historyEpoch++;
			historyId = null;
			events = [];
		},
		dispose() {
			hide();
			lifetime.abort();
		}
	};
}
