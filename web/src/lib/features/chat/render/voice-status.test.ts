import { expect, test } from 'bun:test';
import { voiceStatus } from './voice-status';
const base = {
	state: 'listening',
	mode: 'turns',
	muted: false,
	busy: true,
	working: false,
	phase: 'transcribing'
};
test('one status distinguishes transcription, agent work, voice generation and playback', () => {
	expect(voiceStatus(base).label).toBe('Transcribing');
	expect(
		voiceStatus({
			...base,
			phase: 'working',
			working: true,
			activity: { kind: 'tool', label: 'Searching', detail: 'Looking for the dentist booking' }
		}).detail
	).toBe('Looking for the dentist booking');
	expect(voiceStatus({ ...base, phase: 'synthesizing' }).label).toBe('Preparing voice');
	expect(voiceStatus({ ...base, state: 'speaking' }).label).toBe('Speaking');
	expect(voiceStatus({ ...base, busy: false, muted: true }).label).toBe('Microphone muted');
});
test('an unresolved approval takes priority over work and opens review', () => {
	expect(
		voiceStatus({
			...base,
			phase: 'working',
			working: true,
			activity: {
				kind: 'waiting',
				label: 'Waiting for your approval',
				request: { kind: 'approval', id: 'approval-id' }
			}
		})
	).toEqual({ label: 'Approval needed', detail: 'Tap to review in chat', review: true });
});
