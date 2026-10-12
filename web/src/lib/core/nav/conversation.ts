/** One destination for main, topic, and task conversations, optionally focused on a turn. */
export function conversationHref(id: string, turnId?: string): string {
	const path =
		id === 'main'
			? '/chat'
			: id.startsWith('task-t-')
				? `/tasks/${encodeURIComponent(id.slice(5))}?view=conversation`
				: `/chats/${encodeURIComponent(id)}`;
	return turnId
		? `${path}${path.includes('?') ? '&' : '?'}turn=${encodeURIComponent(turnId)}`
		: path;
}
