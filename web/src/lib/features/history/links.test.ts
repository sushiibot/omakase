/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { chatHitHref } from './links';

test('a chat hit links to its message in Main, a topic or a task conversation', () => {
	expect(chatHitHref({ conversationId: 'main', message: '01K6B4A0C2E4G6J8M0P2R4T6V1' })).toBe(
		'/chat?m=01K6B4A0C2E4G6J8M0P2R4T6V1'
	);
	expect(chatHitHref({ conversationId: 'trip', message: 'outbox-12345' })).toBe(
		'/chats/trip?m=outbox-12345'
	);
	expect(chatHitHref({ conversationId: 'task-t-login', message: 's-3' })).toBe(
		'/tasks/t-login?view=conversation&m=s-3'
	);
});
