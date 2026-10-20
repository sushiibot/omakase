// Scales recipe quantities for a different number of servings.

const UNICODE: Record<string, number> = {
	'¼': 0.25,
	'½': 0.5,
	'¾': 0.75,
	'⅓': 1 / 3,
	'⅔': 2 / 3,
	'⅛': 0.125
};

/** `2`, `1.5`, `1/2`, `1 1/2`, `1½`, `½` as a number; null for text like `a pinch` or `2-3`. */
export function parseQty(qty: string | number): number | null {
	if (typeof qty === 'number') return Number.isFinite(qty) ? qty : null;
	const t = qty.trim();
	let m = /^(\d+)?\s*([¼½¾⅓⅔⅛])$/.exec(t);
	if (m) return Number(m[1] ?? 0) + UNICODE[m[2]];
	m = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(t);
	if (m && Number(m[3]) > 0) return Number(m[1] ?? 0) + Number(m[2]) / Number(m[3]);
	if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
	return null;
}

const FRACTIONS: [number, string][] = [
	[0.25, '¼'],
	[1 / 3, '⅓'],
	[0.5, '½'],
	[2 / 3, '⅔'],
	[0.75, '¾']
];

/** A kitchen-friendly amount: `1½`, `⅔`, `3`, or one decimal when no fraction is close. */
export function formatQty(n: number): string {
	if (n >= 10) return String(Math.round(n));
	const whole = Math.floor(n + 1e-9);
	const frac = n - whole;
	if (frac < 0.06) return String(whole);
	if (frac > 0.94) return String(whole + 1);
	const near = FRACTIONS.find(([v]) => Math.abs(v - frac) < 0.04);
	if (near) return `${whole || ''}${near[1]}`;
	return String(Math.round(n * 10) / 10);
}

/** The quantity scaled by `factor`, or as written when it isn't a number. */
export function scaleQty(qty: string | number, factor: number): string {
	const n = parseQty(qty);
	if (n === null) return String(qty);
	return factor === 1 && typeof qty === 'string' ? qty : formatQty(n * factor);
}
