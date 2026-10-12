import { expect, test } from 'bun:test';
import { voiceMessages, type VoiceTranscript } from './voice-messages';
import type { ChatMessage } from '../types';
const message = (id: string, role: 'user' | 'assistant', text: string): ChatMessage => ({
	id,
	role,
	parts: [{ type: 'text', text }]
});
const transcript = (): VoiceTranscript => ({
	id: 'voice:1',
	anchors: ['old'],
	userText: 'Check my calendar',
	userFinal: true,
	assistantText: 'Your afternoon is free.',
	assistantFinal: true,
	userId: 'request',
	assistantId: 'reply'
});
test('saved messages replace voice previews by IDs even when transcription or reply text differs', () => {
	const t = transcript();
	const result = voiceMessages(
		[
			{ ...message('user', 'user', 'Check the calendar.'), clientId: 'request' },
			{ ...message('answer', 'assistant', '**Your afternoon is free.**'), turnId: 'reply' }
		],
		[t]
	);
	expect(result.map((m) => m.id)).toEqual(['user', 'answer']);
	expect(result.every((m) => m.voice)).toBe(true);
});
test('a voice user stays before a streamed response, then becomes the saved message without duplicating it', () => {
	const t = transcript();
	t.assistantText = '';
	const old = message('old', 'user', 'Earlier request');
	const answer = {
		...message('answer', 'assistant', 'Checking…'),
		turnId: 'reply',
		streaming: true
	};
	expect(voiceMessages([old, answer], [t]).map((m) => m.id)).toEqual([
		'old',
		'voice:1:user',
		'answer'
	]);
	const user = { ...message('user', 'user', t.userText), clientId: 'request' };
	expect(voiceMessages([old, answer, user], [t]).map((m) => m.id)).toEqual([
		'old',
		'user',
		'answer'
	]);
});
test('a repeated phrase never replaces an older message, and provisional text stays italic until finalized', () => {
	const t = transcript();
	t.userId = undefined;
	t.assistantId = undefined;
	t.assistantText = '';
	t.userFinal = false;
	const result = voiceMessages([message('old', 'user', t.userText)], [t]);
	expect(result).toHaveLength(2);
	expect(result[1]?.partial).toBe(true);
});
