import { expect, test } from 'bun:test';
import { LiveTranscription, type Recognition } from './live-transcription';
test('interim revisions replace previous text, and cancelled callbacks cannot affect a new recording', () => {
	const engines: Recognition[] = [];
	class Engine implements Recognition {
		continuous = false;
		interimResults = false;
		lang = '';
		onresult: Recognition['onresult'] = null;
		onerror: Recognition['onerror'] = null;
		onend: Recognition['onend'] = null;
		start() {
			engines.push(this);
		}
		abort() {}
	}
	const text: string[] = [];
	const live = new LiveTranscription(() => Engine);
	expect(live.start((value) => text.push(value))).toBe(true);
	const engine = engines[0]!;
	expect(engine.interimResults).toBe(true);
	const late = engine.onresult!;
	const error = engine.onerror!;
	late({ results: [{ 0: { transcript: 'Check my calender' }, isFinal: false }] });
	late({ results: [{ 0: { transcript: 'Check my calendar' }, isFinal: true }] });
	expect(text).toEqual(['Check my calender', 'Check my calendar']);
	live.stop();
	live.start((value) => text.push(value));
	late({ results: [{ 0: { transcript: 'stale words' }, isFinal: false }] });
	error({ error: 'aborted' });
	expect(engines[1]!.onresult).not.toBeNull();
	expect(text).toHaveLength(2);
	live.stop();
});
test('unsupported or rejected browser recognition falls back without blocking recorded transcription', () => {
	expect(new LiveTranscription(() => undefined).start(() => {})).toBe(false);
});
