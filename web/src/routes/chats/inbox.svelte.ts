import { onMount, untrack } from 'svelte';
import { afterNavigate, goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { page } from '$app/state';
import { previousPathIs } from '$lib/core/nav/back';
import type { RoutedSheet } from '$lib/core/nav/sheet';
import { closeShownNotifications } from '$lib/core/pwa/notifications';
import { pwa } from '$lib/core/pwa/pwa.svelte';
import { hub } from '$lib/core/realtime/hub.svelte';
import { threadsStore } from '$lib/features/threads';
import { chatStore } from '$lib/features/chat';
import {
	deepLinkItem,
	messagePreview,
	needsYou,
	type HomeItem,
	type HomePeek
} from '$lib/features/home';
import type { ConnectionState } from '$lib/ui/connection-banner.svelte';

export const inboxDisclosure = $state({ expanded: false });

/** Home's records, peek sheet and discussion flow for the Channels inbox; call during component init. */
export function createInbox(destination: '/chats' | '/assistant' = '/chats') {
	const home = needsYou();
	home.open();
	// Review is a real URL entry: linked pages push above it, and reload keeps the item.
	let closing = false;
	afterNavigate(() => {
		closing = false;
	});
	const sheet: RoutedSheet = {
		get open() {
			return deepLinkItem(page.url.searchParams) !== null;
		},
		get arg() {
			return deepLinkItem(page.url.searchParams) ?? undefined;
		},
		openWith(id) {
			if (!id) return;
			const url = new URL(page.url);
			url.searchParams.delete('approve');
			url.searchParams.delete('ask');
			url.searchParams.delete('discuss');
			url.searchParams.set('item', id);
			void goto(url, {
				noScroll: true,
				keepFocus: true,
				replaceState: this.open,
				state: {
					...page.state,
					reviewOrigin: this.open ? page.state.reviewOrigin : page.url.pathname + page.url.search
				}
			});
		},
		close() {
			if (!this.open || closing) return;
			closing = true;
			if (page.url.searchParams.get('discuss') === '1') {
				stopDiscussing();
				return;
			}
			if (page.state.reviewOrigin || previousPathIs(destination)) history.back();
			else {
				const url = new URL(page.url);
				for (const key of ['item', 'approve', 'ask']) url.searchParams.delete(key);
				void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
			}
		}
	};
	const conversations = threadsStore();
	const discussing = $derived(
		page.url.searchParams.get('discuss') === '1'
			? Object.values(home.groups)
					.flat()
					.find((item) => item.id === sheet.arg)
			: undefined
	);
	let discussionBusy = $state(false);
	let discussionError = $state<string | null>(null);
	$effect(() => {
		if (!sheet.open) {
			discussionError = null;
		}
	});
	let waitedForReview = $state(false);

	let now = $state(Date.now());
	onMount(() => {
		const reviewWait = setTimeout(() => (waitedForReview = true), 5000);
		const t = setInterval(() => (now = Date.now()), 30_000);
		return () => {
			clearInterval(t);
			clearTimeout(reviewWait);
		};
	});

	const unreachable = $derived(
		!pwa.online || hub.connection === 'forbidden' || hub.connection === 'closed'
	);
	const connection = $derived.by((): ConnectionState | 'forbidden' | undefined => {
		if (!pwa.online) return { kind: 'app-offline' };
		if (hub.connection === 'forbidden') return 'forbidden';
		if (hub.connection === 'reconnecting') return { kind: 'reconnecting' };
		return undefined;
	});

	const greeted = $derived(home.live.greeted);
	const data = home.data;
	const remote = $derived({
		status:
			greeted || data.status === 'ready'
				? ('ready' as const)
				: data.status === 'error'
					? ('error' as const)
					: ('loading' as const),
		slow: data.slow,
		error: data.error
	});

	// Auto-expand on a load problem, without letting later data updates reset a native toggle.
	$effect(() => {
		if (
			remote.status === 'error' ||
			remote.slow ||
			(greeted && data.error) ||
			(data.data?.workspace.state !== undefined && data.data.workspace.state !== 'online')
		)
			inboxDisclosure.expanded = true;
	});

	const items = $derived(Object.values(home.groups).flat());

	/** Whether Home's records could say for sure that this item is gone. */
	function checked(id: string): boolean {
		if (unreachable) return false;
		// Approvals and asks come from the stream's pending list, which is complete once greeted.
		if (id.startsWith('approval:') || id.startsWith('ask:')) return greeted;
		// The last load failed, or none has finished: the item may still be there.
		if (data.status === 'error' || data.data === undefined) return false;
		// With Home off on the bot there is nothing more to wait for.
		if (data.data === null) return true;
		if (id.startsWith('run:')) return data.data?.workspace.state === 'online';
		return true;
	}
	const peek = $derived.by((): HomePeek | undefined => {
		const id = sheet.arg;
		if (!sheet.open || !id) return undefined;
		const item = items.find((i) => i.id === id);
		const nonce = id.startsWith('approval:') ? id.slice('approval:'.length) : null;
		return {
			id,
			item,
			missing: item
				? undefined
				: checked(id)
					? 'handled'
					: !unreachable && !waitedForReview && (!greeted || data.status === 'loading')
						? 'loading'
						: 'offline',
			submitting: nonce ? home.submitting.includes(nonce) : false,
			result: home.results[id]
		};
	});

	// Opening an inbox item reads it; it stays until marked done.
	$effect(() => {
		const id = peek?.item?.group === 'review' ? peek.id : undefined;
		if (id) untrack(() => home.markRead(id));
	});

	// Item ids are the push tags, so opening an item clears its notification.
	$effect(() => {
		const id = peek?.item ? peek.id : undefined;
		if (!id) return;
		void closeShownNotifications(new Set([id])).catch(() => {
			// Nothing to clear if the worker is gone.
		});
	});

	// Forward navigation keeps review underneath. Back returns to its exact URL and state.
	const leaveTo = (href: string) => goto(href);
	const openChat = () => goto(resolve('/chat'));

	function done(id: string) {
		const item = items.find((i) => i.id === id);
		if (!item) return;
		const label =
			item.kind === 'message'
				? messagePreview(item.message.text)
				: item.kind === 'run'
					? item.run.title
					: id;
		home.done(id, label);
		if (sheet.arg === id) sheet.close();
	}

	function discuss(item: HomeItem) {
		discussionError = null;
		const url = new URL(page.url);
		url.searchParams.set('item', item.id);
		url.searchParams.set('discuss', '1');
		void goto(url, { noScroll: true, keepFocus: true, state: page.state });
	}
	function stopDiscussing() {
		discussionError = null;
		if (previousPathIs(destination)) history.back();
		else {
			const url = new URL(page.url);
			url.searchParams.delete('discuss');
			void goto(url, { replaceState: true, noScroll: true, keepFocus: true, state: page.state });
		}
	}

	function discussionQuote(item: HomeItem): string {
		if (item.kind === 'message')
			return `> From ${item.message.job}:\n${item.message.text
				.split('\n')
				.map((line) => `> ${line}`)
				.join('\n')}\n\n`;
		if (item.kind === 'alert')
			return [
				`> Scheduled job ${item.alert.job} ${item.alert.kind === 'stuck' ? 'is stuck' : 'failed'}`,
				...(item.alert.error ? item.alert.error.split('\n').map((line) => `> ${line}`) : []),
				'',
				''
			].join('\n');
		return '';
	}

	async function chooseConversation(id: string, createTitle?: string) {
		if (!discussing || discussionBusy) return;
		const item = discussing;
		discussionBusy = true;
		discussionError = null;
		try {
			if (createTitle) {
				const created = await conversations.branch('', createTitle);
				if (!created) throw new Error(conversations.error ?? "Couldn't create the conversation.");
				id = created;
			}
			let store = chatStore();
			if (id !== 'main') {
				const detail = conversations.thread(id);
				await detail.ensure();
				if (!detail.data)
					throw new Error(detail.error ?? "Couldn't open the conversation. Try again.");
				store = conversations.chat(detail.data);
			}
			await store.start();
			if (!sheet.open || discussing?.id !== item.id) return;
			const quote = discussionQuote(item);
			store.setDraft(store.draft ? `${store.draft}\n\n${quote}` : quote);
			if (id === 'main') await goto(resolve('/chat'));
			else await goto(resolve('/chats/[id]', { id }));
		} catch (error) {
			discussionError =
				error instanceof Error ? error.message : "Couldn't open the conversation. Try again.";
		} finally {
			discussionBusy = false;
		}
	}

	return {
		home,
		sheet,
		data,
		get now() {
			return now;
		},
		get connection() {
			return connection;
		},
		get greeted() {
			return greeted;
		},
		get remote() {
			return remote;
		},
		get peek() {
			return peek;
		},
		get discussing() {
			return discussing;
		},
		get discussionBusy() {
			return discussionBusy;
		},
		get discussionError() {
			return discussionError;
		},
		stopDiscussing,
		leaveTo,
		openChat,
		done,
		discuss,
		chooseConversation
	};
}

export type Inbox = ReturnType<typeof createInbox>;
