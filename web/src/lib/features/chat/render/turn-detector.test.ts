import { expect, test } from 'bun:test';
import { TurnDetector } from './turn-detector';
const packet = (amplitude = 0) => new Int16Array(320).fill(amplitude).buffer;
test('idle silence and brief clicks never submit; speech keeps preroll and waits through short pauses', () => {
	const detector = new TurnDetector();
	for (let i = 0; i < 1000; i++) expect(detector.push(packet(100)).audio).toHaveLength(0);
	expect(detector.push(packet(1000)).audio).toHaveLength(0);
	detector.push(packet());
	for (let i = 0; i < 5; i++) expect(detector.push(packet(1000)).audio).toHaveLength(0);
	expect(detector.push(packet(1000)).audio).toHaveLength(20);
	for (let i = 0; i < 40; i++) expect(detector.push(packet()).commit).toBe(false);
	expect(detector.push(packet(1000)).commit).toBe(false);
	for (let i = 0; i < 59; i++) expect(detector.push(packet()).commit).toBe(false);
	expect(detector.push(packet()).commit).toBe(true);
	expect(detector.push(packet()).audio).toHaveLength(0);
});
test('reset discards muted or previous-turn audio and long speech commits before the server limit', () => {
	const detector = new TurnDetector();
	for (let i = 0; i < 6; i++) detector.push(packet(1000));
	detector.reset();
	expect(detector.push(packet()).audio).toHaveLength(0);
	let commits = 0;
	for (let i = 0; i < 12000; i++) if (detector.push(packet(1000)).commit) commits++;
	expect(commits).toBe(1);
});

test('quick pause commits at 800ms but speaking again before then keeps the turn open', () => {
	const detector = new TurnDetector(800);
	for (let i = 0; i < 6; i++) detector.push(packet(1000));
	for (let i = 0; i < 39; i++) expect(detector.push(packet()).commit).toBe(false);
	expect(detector.push(packet(1000)).commit).toBe(false);
	for (let i = 0; i < 39; i++) expect(detector.push(packet()).commit).toBe(false);
	expect(detector.push(packet()).commit).toBe(true);
});
