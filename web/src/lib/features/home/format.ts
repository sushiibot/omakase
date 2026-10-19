import type { HomeMessage } from '$lib/core/realtime/events';
import type { DraftRef } from '$lib/core/storage/outbox';
import type { HomePeek } from './types';

/** Matches the bot's MESSAGE_REF_EXCERPT_MAX; the bot fills in its own copy on receipt. */
const REF_EXCERPT_MAX = 2000;

/** The peek sheet's heading, also its accessible name. */
export function peekTitle(peek: HomePeek): string {
	const item = peek.item;
	if (!item) {
		if (peek.result) return 'Done';
		if (peek.missing === 'loading') return 'Loading review';
		return peek.missing === 'offline' ? "Can't check this now" : 'Already handled';
	}
	switch (item.kind) {
		case 'approval':
			return 'Approval needed';
		case 'ask':
			return 'The agent asks';
		case 'auth':
			return 'Sign-in needed';
		case 'alert':
			return `${item.alert.job} ${item.alert.kind === 'stuck' ? 'is stuck' : 'failed'}`;
		case 'turn':
			return 'Main chat is working';
		case 'run':
			return item.run.title;
		case 'message':
			return `From ${item.message.job}`;
	}
}

/** A job message's row title: its items' titles, or its text as one line. */
export function messageTitle(message: HomeMessage): string {
	return message.items?.length
		? message.items.map((i) => i.title).join(' · ')
		: messagePreview(message.text);
}

/**
 * What an owner message about `message` (or its item `key`, or that item's choice `index`) carries:
 * the ids the bot resolves, and the card shown until it does. Null for an unknown item or choice.
 */
export function messageRef(message: HomeMessage, key?: string, index?: number): DraftRef | null {
	const id = `msg:${message.key}`;
	const base = {
		id,
		job: message.job,
		...(message.runId ? { runId: message.runId } : {}),
		at: message.at
	};
	if (key === undefined)
		return { input: { id }, view: { ...base, excerpt: message.text.slice(0, REF_EXCERPT_MAX) } };
	const item = message.items?.find((i) => i.key === key);
	const choice = index === undefined ? undefined : item?.choices[index];
	if (!item || (index !== undefined && choice === undefined)) return null;
	return {
		input: { id, item: key, ...(index !== undefined ? { choice: index } : {}) },
		view: {
			...base,
			item: { key, title: item.title },
			excerpt: item.body.slice(0, REF_EXCERPT_MAX),
			...(choice !== undefined ? { choice } : {})
		}
	};
}

/** A message's text as one plain line, for a row title. */
export function messagePreview(text: string): string {
	return text
		.replace(/[*_`~]+/g, '')
		.replace(/^[\s#>-]+/gm, '')
		.replace(/\s+/g, ' ')
		.trim();
}
