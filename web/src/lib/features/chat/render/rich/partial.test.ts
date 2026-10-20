/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { render } from 'svelte/server';
import Markdown from '../markdown.svelte';
import { parseMarkdown, type MdBlockNode } from '../markdown';
import { MarkdownStream } from '../streaming';
import { RICH_EXAMPLES, RICH_TYPES, parsePartialRichBlock, parseRichBlock } from './blocks';
import { arr, num, obj, opt, parsePartial, str, validate } from './schema';

// A rich block whose fence is still streaming renders what it holds so far. These check that the
// preview only ever grows toward the finished block and that the finished render is untouched.

const fence = (type: string, body: string) => '```' + type + '\n' + body + '\n```';

/** True when `part` could grow into `whole`: lists no longer, mappings with a subset of the keys,
 *  every value itself a prefix, scalars equal. */
function isPrefixOf(part: unknown, whole: unknown): boolean {
	if (Array.isArray(part)) {
		return (
			Array.isArray(whole) &&
			part.length <= whole.length &&
			part.every((p, i) => isPrefixOf(p, whole[i]))
		);
	}
	if (part && typeof part === 'object') {
		if (!whole || typeof whole !== 'object' || Array.isArray(whole)) return false;
		const w = whole as Record<string, unknown>;
		// A link the markdown rule dropped is an undefined field.
		return Object.entries(part).every(
			([k, v]) => v === undefined || (Object.hasOwn(w, k) && isPrefixOf(v, w[k]))
		);
	}
	return part === whole;
}

/** Every list item at any depth, so a growing tree counts too. */
function itemCount(value: unknown): number {
	if (Array.isArray(value)) return value.length + value.reduce((n, v) => n + itemCount(v), 0);
	if (value && typeof value === 'object') {
		return Object.values(value).reduce((n: number, v) => n + itemCount(v), 0);
	}
	return 0;
}

describe('partial schema mode', () => {
	const s = obj(
		{
			title: str({ max: 10 }),
			note: opt(str({ max: 5 })),
			items: arr(obj({ v: num({ min: 0 }) }), { min: 2, max: 3 })
		},
		(_, report) => report('', 'cross-field rule')
	);

	test('keeps the valid prefix of a list, ignores min, caps at max', () => {
		expect(parsePartial(s, { title: 'T', items: [{ v: 1 }] }) as unknown).toEqual({
			title: 'T',
			items: [{ v: 1 }]
		});
		expect(
			parsePartial(s, { title: 'T', items: [{ v: 1 }, { v: 'x' }, { v: 2 }] }) as unknown
		).toEqual({
			title: 'T',
			items: [{ v: 1 }]
		});
		expect(
			parsePartial(s, { title: 'T', items: [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }] }) as unknown
		).toEqual({ title: 'T', items: [{ v: 1 }, { v: 2 }, { v: 3 }] });
	});

	test('a missing list is empty; unknown keys, bad optional fields and checks wait', () => {
		expect(
			parsePartial(s, { title: 'T', items: null, extra: 1, note: 'too long' }) as unknown
		).toEqual({
			title: 'T',
			items: []
		});
	});

	test('a missing or invalid required scalar means nothing to show yet', () => {
		expect(parsePartial(s, { items: [{ v: 1 }] })).toBeUndefined();
		expect(parsePartial(s, { title: 'far too long here', items: [] })).toBeUndefined();
		expect(parsePartial(s, 'text')).toBeUndefined();
	});

	test('strict validation is unchanged', () => {
		const r = validate(s, { title: 'T', items: [{ v: 1 }], extra: 1 });
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.issues.map((i) => i.path)).toEqual(['extra', 'items']);
		}
	});
});

describe('parsePartialRichBlock', () => {
	test('reads whole lines only', () => {
		expect(parsePartialRichBlock('recipe', 'title: Miso')).toBeNull();
		expect(parsePartialRichBlock('recipe', 'title: Miso\n') as unknown).toEqual({
			type: 'recipe',
			data: { title: 'Miso', ingredients: [], steps: [] }
		});
	});

	test('drops lines while an item is mid-way across several', () => {
		const body = 'segments:\n  - { label: A, value: 1 }\n  - { label: B,\n    value: 2';
		expect(parsePartialRichBlock('breakdown', body + '\n') as unknown).toEqual({
			type: 'breakdown',
			data: { segments: [{ label: 'A', value: 1 }] }
		});
	});

	test('gives up after a few lines rather than scanning the whole body', () => {
		const body = 'title: X\n' + '  - { a: [\n'.repeat(10);
		expect(parsePartialRichBlock('breakdown', body)).toBeNull();
	});

	test('never throws on random input', () => {
		let seed = 11;
		const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
		const alphabet = 'ab:-{}[], \n"\'&*!#|>0123456789.';
		for (let n = 0; n < 300; n++) {
			const body = Array.from(
				{ length: 1 + Math.floor(rand() * 60) },
				() => alphabet[Math.floor(rand() * alphabet.length)]
			).join('');
			for (const type of RICH_TYPES) expect(() => parsePartialRichBlock(type, body)).not.toThrow();
		}
	});
});

describe('streaming a rich block', () => {
	for (const type of RICH_TYPES) {
		test(`${type}: the preview only grows, then the closed fence renders as before`, () => {
			const text = `Intro.\n\n${fence(type, RICH_EXAMPLES[type].example)}\n\nAfter.`;
			const strict = parseRichBlock(type, RICH_EXAMPLES[type].example);
			if (!strict.ok) throw new Error('example must validate');
			const final = strict.block.data;
			const opened = text.indexOf('\n', text.indexOf('```')) + 1;
			const stream = new MarkdownStream(undefined, () => 0);
			let rendered = -1;
			let partials = 0;
			let closed = false;
			for (let i = 1; i <= text.length; i++) {
				const slice = text.slice(0, i);
				const tree = stream.update(slice, {});
				if (i < opened) continue;
				const node = tree[1] as MdBlockNode | undefined;
				expect(node).toBeDefined();
				if (node!.kind === 'rich-pending') {
					expect(rendered, `${type} went back to a placeholder at ${i}`).toBe(-1);
					continue;
				}
				expect(node!.kind).toBe('rich');
				if (node!.kind !== 'rich') continue;
				if (!node!.partial) {
					expect(node!.block).toEqual(strict.block);
					closed = true;
					continue;
				}
				expect(closed, `${type} reopened at ${i}`).toBe(false);
				partials++;
				expect(node!.block.type).toBe(type);
				expect(isPrefixOf(node!.block.data, final), `${type} at ${i}`).toBe(true);
				const count = itemCount(node!.block.data);
				expect(count, `${type} lost an item at ${i}`).toBeGreaterThanOrEqual(rendered);
				rendered = count;
				// Every component draws partial data without throwing.
				expect(() => render(Markdown, { props: { text: slice, streaming: true } })).not.toThrow();
			}
			expect(partials, `${type} showed nothing before its fence closed`).toBeGreaterThan(0);
			expect(closed).toBe(true);
			const done = stream.finish(text, {});
			expect(JSON.stringify(done)).toBe(JSON.stringify(parseMarkdown(text)));
			expect(done[1]).toEqual({ kind: 'rich', block: strict.block });
		});
	}

	test('a partial block shows the caret, and its controls are off until it finishes', () => {
		const off = (tag: string) => / disabled(?:=|[ >])/.test(tag);
		const partial = render(Markdown, {
			props: {
				text: '```recipe\ntitle: Rice\nserves: 2\ningredients:\n  - { qty: 1, unit: cup, item: rice }\nsteps:\n  - Simmer for 12 minutes.\n',
				streaming: true,
				reply: () => {}
			}
		}).body;
		expect(partial).toContain('aria-busy="true"');
		expect(partial).toContain('data-caret');
		expect(partial).toContain('Serves 2');
		const tag = (html: string, label: string) =>
			[...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(label)) ?? '';
		expect(off(tag(partial, 'aria-label="More servings"'))).toBe(true);
		expect(off(tag(partial, 'aria-label="Start Step 1"'))).toBe(true);
		expect(off(tag(partial, 'role="checkbox"'))).toBe(true);

		const actions = render(Markdown, {
			props: { text: '```actions\nitems:\n  - Yes\n  - No\n', streaming: true, reply: () => {} }
		}).body;
		expect(actions).toContain('aria-busy="true"');
		expect(actions).not.toContain('work in the latest reply');
		const buttons = (html: string) => [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
		expect(buttons(actions).length).toBe(2);
		expect(buttons(actions).every(off)).toBe(true);

		const finished = render(Markdown, {
			props: { text: fence('actions', 'items:\n  - Yes\n  - No'), reply: () => {} }
		}).body;
		expect(finished).not.toContain('aria-busy');
		expect(buttons(finished).length).toBe(2);
		expect(buttons(finished).some(off)).toBe(false);
	});
});
