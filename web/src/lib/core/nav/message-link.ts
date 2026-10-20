import { goto } from '$app/navigation';
import { page } from '$app/state';

/** The params a conversation link carries (docs/message-links.md). */
const LINK_PARAMS = ['m', 'turn', 'ask', 'approve'];

/**
 * Drops the message link from this entry's URL once the reader has left it ("Jump to latest"), so a
 * reload opens at the newest message. Replaces the entry: Back still returns to where the link was
 * opened, and an open sheet keeps its state.
 */
export function leaveMessageLink(): Promise<void> {
	const url = new URL(page.url);
	if (!LINK_PARAMS.some((key) => url.searchParams.has(key))) return Promise.resolve();
	for (const key of LINK_PARAMS) url.searchParams.delete(key);
	return goto(url.pathname + url.search + url.hash, {
		replaceState: true,
		noScroll: true,
		keepFocus: true,
		state: page.state
	});
}
