import { conversationHref } from '$lib/core/nav/conversation';
import type { LinkTarget } from './links';
import type { ChatStore } from './store.svelte';

/**
 * ChatScreen's message-link props for a store (docs/message-links.md): where the URL's link points,
 * where it landed, the detached window's paging, and each message's own link for Copy link.
 * `leaveUrl` drops the link from the URL after "Jump to latest".
 */
export function linkProps(store: ChatStore, target: LinkTarget | null, leaveUrl?: () => void) {
	const id =
		store.conversationId === 'main' ? 'main' : store.conversationId.slice('thread:'.length);
	return {
		focusMessage: target?.message,
		focusTurn: target?.turn,
		focusAsk: target?.ask,
		focusApproval: target?.approve,
		messageHref: (key: string) => conversationHref(id, { message: key }),
		landing: store.landing,
		detached: store.detached,
		hasNewer: store.hasNewer,
		newerLoading: store.newerLoading,
		newerError: store.newerError,
		onopenlink: (t: LinkTarget, retry?: boolean) => void store.openLink(t, retry),
		onleavelink: () => store.leaveLink(),
		onloadnewer: () => store.loadNewer(),
		onjumplatest: () => leaveUrl?.()
	};
}
