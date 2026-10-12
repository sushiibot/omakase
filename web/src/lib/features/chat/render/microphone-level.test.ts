import { expect, test } from 'bun:test';
import { microphoneLevel } from './microphone-level';

test('meter reports silence and real signal strength consistently for PCM16 and float capture', () => {
	expect(microphoneLevel([])).toBe(0);
	expect(microphoneLevel(new Float32Array(512))).toBe(0);
	const quiet = microphoneLevel(new Float32Array(512).fill(0.01));
	const speech = microphoneLevel(new Float32Array(512).fill(0.1));
	expect(quiet).toBeGreaterThan(0);
	expect(speech).toBeGreaterThan(quiet);
	expect(microphoneLevel(new Int16Array(512).fill(3277), 32768)).toBeCloseTo(speech, 3);
	expect(microphoneLevel(new Float32Array(512).fill(1))).toBe(1);
});
