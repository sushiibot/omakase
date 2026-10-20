// Conversation links (docs/message-links.md): what a link asks for and where it landed.

/** What a conversation link lands on. One field is set. */
export interface LinkTarget {
	message?: string;
	turn?: string;
	ask?: string;
	approve?: string;
}

/** Where the last conversation link landed, for the screen to move to once. */
export interface Landing {
	/** The link this answers, as `m:<id>`, `turn:<id>`, `ask:<id>` or `approve:<id>`. */
	ref: string;
	/** Grows with each landing, so the screen moves to each one once. */
	n: number;
	/** `missing`: the message is gone; `messageId`, when set, is the nearest one. */
	state: 'loading' | 'found' | 'missing' | 'error';
	/** The row to move to. */
	messageId?: string;
	/** A card inside a row, focused in place of the row. */
	askId?: string;
	nonce?: string;
	/** When the message, or the nearest one, was sent. */
	at?: string;
}

export function linkRef(t: LinkTarget): string {
	if (t.message) return `m:${t.message}`;
	if (t.turn) return `turn:${t.turn}`;
	if (t.ask) return `ask:${t.ask}`;
	return `approve:${t.approve ?? ''}`;
}

/** The link in a conversation URL's params, or null. `?m=` wins over the older params. */
export function linkTarget(params: URLSearchParams): LinkTarget | null {
	const pick = (key: string) => params.get(key) || undefined;
	const message = pick('m');
	if (message) return { message };
	const turn = pick('turn');
	if (turn) return { turn };
	const ask = pick('ask');
	if (ask) return { ask };
	const approve = pick('approve');
	return approve ? { approve } : null;
}
