import { expect, test } from 'bun:test';
import { clampOffset, horizontalIntent, offsetFor, releasePane } from './pane-motion';

test('vertical and undecided gestures retain browser ownership', () => {
	expect(horizontalIntent(5, 1)).toBe(false);
	expect(horizontalIntent(14, 12)).toBe(false);
	expect(horizontalIntent(4, 30)).toBe(false);
	expect(horizontalIntent(24, 6)).toBe(true);
});

test('short drags return, long drags open, and direction applies symmetrically', () => {
	expect(releasePane(60, 0, 320, 360)).toBe('chat');
	expect(releasePane(220, 0, 320, 360)).toBe('navigation');
	expect(releasePane(-60, 0, 320, 360)).toBe('chat');
	expect(releasePane(-240, 0, 320, 360)).toBe('inspector');
});

test('a flick opens a pane and a reversal closes an almost-open pane', () => {
	expect(releasePane(60, 0.8, 320, 360)).toBe('navigation');
	expect(releasePane(-60, -0.9, 320, 360)).toBe('inspector');
	expect(releasePane(230, -0.7, 320, 360)).toBe('chat');
	expect(releasePane(-250, 0.8, 320, 360)).toBe('chat');
});

test('pane offsets stop at their boundaries', () => {
	expect(clampOffset(900, 320, 360)).toBe(320);
	expect(clampOffset(-900, 320, 360)).toBe(-360);
	expect(offsetFor('chat', 320, 360)).toBe(0);
	expect(offsetFor('navigation', 320, 360)).toBe(320);
	expect(offsetFor('inspector', 320, 360)).toBe(-360);
});

test('open panes close with a short deliberate drag or shorter inward flick', () => {
	expect(releasePane(256, 0, 320, 360, 'navigation')).toBe('chat');
	expect(releasePane(-296, 0, 320, 360, 'inspector')).toBe('chat');
	expect(releasePane(288, -0.4, 320, 360, 'navigation')).toBe('chat');
	expect(releasePane(-328, 0.4, 320, 360, 'inspector')).toBe('chat');
});

test('closing ignores tiny flicks and outward reversals, and cannot switch to the opposite pane', () => {
	expect(releasePane(310, -2, 320, 360, 'navigation')).toBe('navigation');
	expect(releasePane(-350, 2, 320, 360, 'inspector')).toBe('inspector');
	expect(releasePane(288, 0, 320, 360, 'navigation')).toBe('navigation');
	expect(releasePane(-328, 0, 320, 360, 'inspector')).toBe('inspector');
	expect(releasePane(280, 1, 320, 360, 'navigation')).toBe('navigation');
	expect(releasePane(-320, -1, 320, 360, 'inspector')).toBe('inspector');
	expect(releasePane(-200, -1, 320, 360, 'navigation')).toBe('chat');
	expect(releasePane(200, 1, 320, 360, 'inspector')).toBe('chat');
});
