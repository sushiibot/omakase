import { expect, test } from 'bun:test';
import { NativeCallAudio } from './call-audio';

test('hangup during native setup releases audio before a subsequent call starts', async () => {
	const calls: string[] = [];
	let ready!: () => void;
	const gate = new Promise<void>((resolve) => (ready = resolve));
	const audio = new NativeCallAudio(
		{
			async start() {
				calls.push('start');
				await gate;
			},
			async stop() {
				calls.push('stop');
			}
		},
		() => true
	);
	const starting = audio.start();
	const stopping = audio.stop();
	const restarting = audio.start();
	await Promise.resolve();
	expect(calls).toEqual(['start']);
	ready();
	await Promise.all([starting, stopping, restarting]);
	expect(calls).toEqual(['start', 'stop', 'start']);
});

test('failed setup still allows cleanup and another call', async () => {
	let stopped = false;
	let attempts = 0;
	const audio = new NativeCallAudio(
		{
			async start() {
				if (++attempts === 1) throw new Error('Audio focus denied');
			},
			async stop() {
				stopped = true;
			}
		},
		() => true
	);
	await expect(audio.start()).rejects.toThrow('Audio focus denied');
	await audio.stop();
	await audio.start();
	expect(stopped).toBe(true);
	expect(attempts).toBe(2);
});

test('browsers and older APKs keep web audio without calling the native plugin', async () => {
	const unexpected = async () => {
		throw new Error('Native method called');
	};
	const audio = new NativeCallAudio({ start: unexpected, stop: unexpected }, () => false);
	await audio.start();
	await audio.stop();
});
