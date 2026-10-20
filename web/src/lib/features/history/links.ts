import { conversationHref } from '$lib/core/nav/conversation';
import type { ChatHit } from './types';

/** The matched message in its conversation (docs/message-links.md). */
export function chatHitHref(hit: Pick<ChatHit, 'conversationId' | 'message'>): string {
	return conversationHref(hit.conversationId, { message: hit.message });
}
