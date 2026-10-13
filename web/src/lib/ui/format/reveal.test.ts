import { expect, test } from 'bun:test';
import { revealInvisible } from './reveal';

test('invisible direction and zero-width characters become visible code points', () => {
	expect(revealInvisible('rm -rf ‮fdp.txt')).toBe('rm -rf ⟨U+202E⟩fdp.txt');
	expect(revealInvisible('a​b⁦c⁩﻿')).toBe('a⟨U+200B⟩b⟨U+2066⟩c⟨U+2069⟩⟨U+FEFF⟩');
	expect(revealInvisible('plain é ✓')).toBe('plain é ✓');
});
