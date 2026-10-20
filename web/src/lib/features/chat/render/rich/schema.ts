// A small, dependency-free schema language for rich reply blocks. The gateway imports this file too
// (src/workspace/richOutput.ts), so the web renderer and the server-side check agree exactly: same
// input, same verdict. Every check is deterministic and reports a path the model can act on.

export interface Issue {
	/** Dotted path into the block, `segments[2].value`; empty for the block itself. */
	path: string;
	message: string;
}

export interface Schema<T> {
	/** Returns the cleaned value, or undefined after pushing at least one issue. */
	parse(value: unknown, path: string, issues: Issue[]): T | undefined;
	/** A compact type sketch for the prompt, `string ≤80`. */
	doc(): string;
	readonly optional: boolean;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

const fail = (issues: Issue[], path: string, message: string): undefined => {
	issues.push({ path, message });
	return undefined;
};

const describe = (value: unknown): string => {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'a list';
	if (typeof value === 'object') return 'a mapping';
	if (typeof value === 'string') return `"${value.length > 30 ? value.slice(0, 30) + '…' : value}"`;
	return String(value);
};

const join = (path: string, key: string | number) =>
	typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key;

// C0/C1 controls other than tab and newline never belong in a label.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;

function schema<T>(parse: Schema<T>['parse'], doc: () => string, optional = false): Schema<T> {
	return { parse, doc, optional };
}

/** Text, trimmed. YAML reads `2024` or `true` as scalars; those become their text. */
export function str(
	opts: { max?: number; min?: number; multiline?: boolean } = {}
): Schema<string> {
	const max = opts.max ?? 120;
	const min = opts.min ?? 1;
	return schema(
		(value, path, issues) => {
			if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
			if (typeof value === 'boolean') value = String(value);
			if (typeof value !== 'string')
				return fail(issues, path, `expected text, got ${describe(value)}`);
			let text = value.replace(CONTROL, '').trim();
			if (!opts.multiline) text = text.replace(/\s*\n\s*/g, ' ');
			if (text.length < min) return fail(issues, path, 'must not be empty');
			if (text.length > max)
				return fail(issues, path, `too long (${text.length} > ${max} characters)`);
			return text;
		},
		() => `text ≤${max}`
	);
}

/** A finite number. A string that is only a number (`"85.5"`) counts; `"85.5 kcal"` does not. */
export function num(opts: { min?: number; max?: number; int?: boolean } = {}): Schema<number> {
	return schema(
		(value, path, issues) => {
			if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) value = Number(value);
			if (typeof value !== 'number' || !Number.isFinite(value)) {
				return fail(issues, path, `expected a number, got ${describe(value)}`);
			}
			if (opts.int && !Number.isInteger(value)) return fail(issues, path, 'must be a whole number');
			if (opts.min !== undefined && value < opts.min)
				return fail(issues, path, `must be ≥ ${opts.min}`);
			if (opts.max !== undefined && value > opts.max)
				return fail(issues, path, `must be ≤ ${opts.max}`);
			return value;
		},
		() => {
			const range =
				opts.min !== undefined && opts.max !== undefined
					? ` ${opts.min}–${opts.max}`
					: opts.min !== undefined
						? ` ≥${opts.min}`
						: '';
			return `${opts.int ? 'integer' : 'number'}${range}`;
		}
	);
}

export function bool(): Schema<boolean> {
	return schema(
		(value, path, issues) =>
			typeof value === 'boolean'
				? value
				: fail(issues, path, `expected true or false, got ${describe(value)}`),
		() => 'true|false'
	);
}

export function oneOf<const V extends string>(values: readonly V[]): Schema<V> {
	return schema(
		(value, path, issues) =>
			typeof value === 'string' && (values as readonly string[]).includes(value)
				? (value as V)
				: fail(issues, path, `expected one of ${values.join(', ')}, got ${describe(value)}`),
		() => values.join('|')
	);
}

/** Text or a number, kept as given: stat values like `281` or `"4.2k"`. */
export function textOrNum(opts: { max?: number } = {}): Schema<string | number> {
	const text = str({ max: opts.max ?? 40 });
	return schema(
		(value, path, issues) =>
			typeof value === 'number' && Number.isFinite(value) ? value : text.parse(value, path, issues),
		() => `text|number`
	);
}

/** A cell that is a yes/no mark or short text. */
export function markOrText(opts: { max?: number } = {}): Schema<string | boolean> {
	const text = str({ max: opts.max ?? 60 });
	return schema(
		(value, path, issues) => (typeof value === 'boolean' ? value : text.parse(value, path, issues)),
		() => 'true|false|text'
	);
}

export function arr<T>(item: Schema<T>, opts: { min?: number; max: number }): Schema<T[]> {
	const min = opts.min ?? 1;
	return schema(
		(value, path, issues) => {
			if (!Array.isArray(value))
				return fail(issues, path, `expected a list, got ${describe(value)}`);
			if (value.length < min)
				return fail(issues, path, `needs at least ${min} item${min === 1 ? '' : 's'}`);
			if (value.length > opts.max)
				return fail(issues, path, `at most ${opts.max} items (got ${value.length})`);
			const before = issues.length;
			const out = value.map((v, i) => item.parse(v, join(path, i), issues));
			return issues.length === before ? (out as T[]) : undefined;
		},
		() => `[${item.doc()}] ${min}–${opts.max}`
	);
}

export function opt<T>(inner: Schema<T>): Schema<T | undefined> {
	return schema(
		(value, path, issues) =>
			value === undefined || value === null ? undefined : inner.parse(value, path, issues),
		() => inner.doc(),
		true
	);
}

/** Defers construction, so a schema can contain itself (trees). */
export function lazy<T>(make: () => Schema<T>, doc: string): Schema<T> {
	let inner: Schema<T> | undefined;
	return schema(
		(value, path, issues) => (inner ??= make()).parse(value, path, issues),
		() => doc
	);
}

type Shape = Record<string, Schema<unknown>>;
type OptionalKeys<S extends Shape> = {
	[K in keyof S]: S[K]['optional'] extends true ? K : never;
}[keyof S];
export type ObjOf<S extends Shape> = { [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } & {
	[K in OptionalKeys<S>]?: Exclude<Infer<S[K]>, undefined>;
};

/** A mapping with exactly these keys. Unknown keys are an error, so a typo is reported, not lost.
 *  `check` runs after every field parsed, for rules that span fields. */
export function obj<S extends Shape>(
	shape: S,
	check?: (value: ObjOf<S>, report: (path: string, message: string) => void) => void
): Schema<ObjOf<S>> {
	return schema(
		(value, path, issues) => {
			if (typeof value !== 'object' || value === null || Array.isArray(value)) {
				return fail(issues, path, `expected a mapping, got ${describe(value)}`);
			}
			const before = issues.length;
			const record = value as Record<string, unknown>;
			const allowed = Object.keys(shape);
			for (const key of Object.keys(record)) {
				if (!Object.hasOwn(shape, key)) {
					fail(issues, join(path, key), `unknown field (allowed: ${allowed.join(', ')})`);
				}
			}
			const out: Record<string, unknown> = {};
			for (const key of allowed) {
				const field = shape[key];
				const raw = Object.hasOwn(record, key) ? record[key] : undefined;
				if ((raw === undefined || raw === null) && !field.optional) {
					fail(issues, join(path, key), 'required');
					continue;
				}
				const parsed = field.parse(raw, join(path, key), issues);
				if (parsed !== undefined) out[key] = parsed;
			}
			if (issues.length !== before) return undefined;
			check?.(out as ObjOf<S>, (p, message) => fail(issues, join(path, p), message));
			return issues.length === before ? (out as ObjOf<S>) : undefined;
		},
		() => {
			const fields = Object.entries(shape).map(
				([key, field]) => `${key}${field.optional ? '?' : ''}: ${field.doc()}`
			);
			return `{ ${fields.join(', ')} }`;
		}
	);
}

/** Runs `schema` on `value`: the cleaned value, or every issue found. */
export function validate<T>(
	s: Schema<T>,
	value: unknown
): { ok: true; value: T } | { ok: false; issues: Issue[] } {
	const issues: Issue[] = [];
	const out = s.parse(value, '', issues);
	return out === undefined || issues.length ? { ok: false, issues } : { ok: true, value: out };
}
