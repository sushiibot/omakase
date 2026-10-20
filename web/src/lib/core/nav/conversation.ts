/** Where a conversation link lands: a message (`m`, see docs/message-links.md) or a turn. */
export interface ConversationTarget {
	/** A message id: its stable key (reply/proactive outbox id, user client id, ask id), or
	 *  `s<seq>` for a stored event with no key (imported history). */
	message?: string;
	/** Older links: the turn whose reply to focus. */
	turn?: string;
}

/** A message id a link may carry. */
export const MESSAGE_REF_RE = /^(?:[0-9A-Za-z_-]{8,64}|s-?\d{1,15})$/;

/** One destination for main, topic, and task conversations, optionally landing on a message or
 *  turn. A string second argument is a turn id, as before. */
export function conversationHref(id: string, target?: string | ConversationTarget): string {
	const path =
		id === 'main'
			? '/chat'
			: id.startsWith('task-t-')
				? `/tasks/${encodeURIComponent(id.slice(5))}?view=conversation`
				: `/chats/${encodeURIComponent(id)}`;
	const t = typeof target === 'string' ? { turn: target } : (target ?? {});
	const params = [
		...(t.message ? [`m=${encodeURIComponent(t.message)}`] : []),
		...(t.turn ? [`turn=${encodeURIComponent(t.turn)}`] : [])
	];
	return params.length ? `${path}${path.includes('?') ? '&' : '?'}${params.join('&')}` : path;
}
