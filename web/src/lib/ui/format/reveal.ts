// app: shows hidden and bidirectional characters in approval text (ux-guidelines.md#approval-cards)
// Bidirectional overrides and zero-width characters can make shown text differ from what runs.
const HIDDEN = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** Text with each invisible formatting character shown as its code point, such as ⟨U+202E⟩. */
export function revealInvisible(text: string): string {
	return text.replace(
		HIDDEN,
		(c) => `⟨U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟩`
	);
}
