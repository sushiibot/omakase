import { expect, test } from 'bun:test';
import { AudioSessionLease } from './audio-session';
test('audio intent follows recording and playback, restores the previous mode, and respects external changes', () => {
	const session = { type: 'auto' };
	const lease = new AudioSessionLease(() => session);
	lease.set('play-and-record');
	lease.set('playback');
	expect(session.type).toBe('playback');
	lease.restore();
	expect(session.type).toBe('auto');
	lease.set('play-and-record');
	session.type = 'transient';
	lease.restore();
	expect(session.type).toBe('transient');
});
test('absent or rejecting audio-session APIs do not prevent voice', () => {
	const missing = new AudioSessionLease(() => undefined);
	expect(() => {
		missing.set('playback');
		missing.restore();
	}).not.toThrow();
	const rejected = new AudioSessionLease(() => ({
		get type() {
			return 'auto';
		},
		set type(_value) {
			throw new Error('Unsupported');
		}
	}));
	expect(() => {
		rejected.set('play-and-record');
		rejected.restore();
	}).not.toThrow();
});
