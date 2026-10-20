/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { render } from 'svelte/server';
import Markdown from '../markdown.svelte';
import { parseMarkdown, type MdBlockNode } from '../markdown';
import { MarkdownStream } from '../streaming';
import { plainText } from '../plain-text';
import {
	CONTAINER_NAMES,
	RICH_EXAMPLES,
	RICH_TYPES,
	parseRichBlock,
	richOutputInstructions,
	parseDuration,
	richPlainText,
	shares,
	stepDuration,
	withUnit
} from './blocks';
import { formatQty, parseQty, scaleQty } from '../interactive/scale';
import { arr, num, obj, opt, str, validate } from './schema';
import { lintRichMarkdown, missedBlocks, richRepairMessage } from './syntax';
import { parseRichYaml, RICH_BODY_MAX } from './yaml';
import { calendarUrl, eventWhen, mapsUrl } from './links';

const fence = (type: string, body: string) => '```' + type + '\n' + body + '\n```';
const html = (text: string) => render(Markdown, { props: { text } }).body;

describe('schema', () => {
	const s = obj({
		title: opt(str({ max: 5 })),
		items: arr(obj({ v: num({ min: 0 }) }), { max: 2 })
	});

	test('reports every issue with its path', () => {
		const r = validate(s, { title: 'too long', items: [{ v: -1 }, { v: 'x' }], extra: 1 });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.issues.map((i) => `${i.path}: ${i.message}`)).toEqual([
			'extra: unknown field (allowed: title, items)',
			'title: too long (8 > 5 characters)',
			'items[0].v: must be ≥ 0',
			'items[1].v: expected a number, got "x"'
		]);
	});

	test('a plain numeric string is a number; a number with a unit is not', () => {
		expect(validate(num(), '85.5')).toEqual({ ok: true, value: 85.5 });
		expect(validate(num(), '85.5 kcal').ok).toBe(false);
	});

	test('text drops control and bidi characters and folds newlines', () => {
		expect(validate(str(), ' a‮b\u0007\nc ')).toEqual({ ok: true, value: 'ab c' });
		expect(validate(str(), 2024)).toEqual({ ok: true, value: '2024' });
		expect(validate(str(), '   ').ok).toBe(false);
	});
});

describe('yaml', () => {
	test.each([
		['aliases', 'a: &x [1]\nb: *x'],
		['tags', 'a: !!binary aGk='],
		['js tags', 'a: !js/function "x"'],
		['duplicate keys', 'a: 1\na: 2'],
		['syntax errors', 'x: { a: 1'],
		['deep nesting', 'a: ' + '['.repeat(12) + ']'.repeat(12)]
	])('rejects %s', (_, body) => {
		expect(parseRichYaml(body).ok).toBe(false);
	});

	test('rejects an oversized body without parsing it', () => {
		expect(parseRichYaml('a: ' + 'x'.repeat(RICH_BODY_MAX))).toMatchObject({ ok: false });
	});

	test('a billion-laughs body fails fast', () => {
		const lol = [
			'a: &a ["lol"]',
			...Array.from(
				{ length: 9 },
				(_, i) => `${'bcdefghij'[i]}: &${'bcdefghij'[i]} [*${'abcdefghi'[i]}, *${'abcdefghi'[i]}]`
			)
		].join('\n');
		const t0 = performance.now();
		expect(parseRichYaml(lol).ok).toBe(false);
		expect(performance.now() - t0).toBeLessThan(200);
	});

	test('dates and yes/no stay text under the core schema', () => {
		expect(parseRichYaml('d: 2024-01-01\nb: yes')).toEqual({
			ok: true,
			value: { d: '2024-01-01', b: 'yes' }
		});
	});
});

describe('catalog', () => {
	test.each(RICH_TYPES)('the %s prompt example validates and renders', (type) => {
		const result = parseRichBlock(type, RICH_EXAMPLES[type].example);
		expect(result.ok).toBe(true);
		const tree = parseMarkdown(fence(type, RICH_EXAMPLES[type].example));
		expect(tree.map((n) => n.kind)).toEqual(['rich']);
		const out = html(fence(type, RICH_EXAMPLES[type].example));
		expect(out).not.toContain('data-lang');
		if (result.ok) expect(richPlainText(result.block).length).toBeGreaterThan(0);
	});

	test('the prompt names every block and container', () => {
		const prompt = richOutputInstructions();
		for (const type of RICH_TYPES) expect(prompt).toContain('```' + type);
		for (const name of CONTAINER_NAMES) expect(prompt).toContain(`\`${name}\``);
	});

	test('breakdown shares always sum to 100', () => {
		expect(shares([117.5, 78.3, 85.5])).toEqual([42, 28, 30]);
		for (let n = 1; n < 8; n++) {
			const values = Array.from({ length: n }, (_, i) => ((i * 37) % 11) + 1);
			expect(shares(values).reduce((a, b) => a + b, 0)).toBe(100);
		}
		expect(shares([0, 0])).toEqual([0, 0]);
	});

	test('units go on the side they are read', () => {
		expect(withUnit(412, '$')).toBe('$412');
		expect(withUnit(5.14, 'kg')).toBe('5.1 kg');
		expect(withUnit(1234.6)).toBe('1,235');
		expect(withUnit(117.5)).toBe('117.5');
	});

	test('compare rows need one value per option', () => {
		const r = parseRichBlock(
			'compare',
			'options: [{name: A}, {name: B}]\nrows: [{label: x, values: [true]}]'
		);
		expect(r.ok).toBe(false);
		if (!r.ok)
			expect(r.issues[0]).toEqual({
				path: 'rows[0].values',
				message: 'needs 2 values, one per option (got 1)'
			});
	});

	test('cards accept only absolute http(s) links', () => {
		for (const href of [
			'javascript:alert(1)',
			'data:text/html,x',
			'/api/chat/approvals/x',
			'//evil.example'
		]) {
			expect(parseRichBlock('cards', `items: [{title: x, href: "${href}"}]`).ok).toBe(false);
		}
	});

	test('a tree is capped in total size', () => {
		const kids = Array.from(
			{ length: 12 },
			(_, i) => `{label: c${i}, children: [{label: a}, {label: b}, {label: c}]}`
		);
		expect(parseRichBlock('tree', `root: {label: r, children: [${kids.join(', ')}]}`).ok).toBe(
			false
		);
	});
});

describe('rendering', () => {
	test('an invalid block falls back to code that names the problem', () => {
		const tree = parseMarkdown(fence('breakdown', 'segments:\n  - { label: A, value: 85.5 kcal }'));
		expect(tree[0]).toMatchObject({
			kind: 'code',
			lang: 'breakdown',
			invalid: ['segments[0].value: expected a number, got "85.5 kcal"']
		});
		const out = html(fence('breakdown', 'segments: nope'));
		expect(out).toContain("Couldn't show this breakdown");
		expect(out).toContain('data-lang="breakdown"');
	});

	test('a finished reply with an unclosed rich fence shows code, not a block', () => {
		const tree = parseMarkdown('```stats\nitems: [{label: a, value: 1}]');
		expect(tree[0]).toMatchObject({ kind: 'code', invalid: ['the code fence is not closed'] });
	});

	test('while streaming, an open rich fence shows what it holds so far, never raw YAML', () => {
		const stream = new MarkdownStream(
			(t) => t,
			() => 0
		);
		expect(stream.update('Here:\n\n```recipe\nserves: 2\n', {}).at(-1)).toEqual({
			kind: 'rich-pending',
			type: 'recipe'
		});
		const tree = stream.update('Here:\n\n```breakdown\nsegments:\n  - { label: A', {});
		expect(tree.map((n) => n.kind)).toEqual(['paragraph', 'rich']);
		expect(tree[1] as unknown).toEqual({
			kind: 'rich',
			block: { type: 'breakdown', data: { segments: [] } },
			partial: true
		});
		const done = stream.finish(
			'Here:\n\n' + fence('breakdown', 'segments:\n  - { label: A, value: 1 }'),
			{}
		);
		expect(done.map((n) => n.kind)).toEqual(['paragraph', 'rich']);
	});

	test('a reply streamed one character at a time never throws and ends as the finished render', () => {
		const text = [
			'Intro **bold**.',
			fence('flow', RICH_EXAMPLES.flow.example),
			':::callout{tone="warn" title="Heads up"}\nBody with [a link](https://x.example).\n:::',
			fence('bars', RICH_EXAMPLES.bars.example),
			':::columns\nLeft\n\n---\n\nRight\n:::',
			'Bye.'
		].join('\n\n');
		const stream = new MarkdownStream(undefined, () => 0);
		for (let i = 1; i <= text.length; i++) stream.update(text.slice(0, i), {});
		expect(JSON.stringify(stream.finish(text, {}))).toBe(JSON.stringify(parseMarkdown(text)));
	});

	test('random bodies never throw', () => {
		let seed = 7;
		const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
		const alphabet = 'ab:-{}[], \n"\'&*!#|>0123456789.';
		for (let n = 0; n < 300; n++) {
			const body = Array.from(
				{ length: Math.floor(rand() * 80) },
				() => alphabet[Math.floor(rand() * alphabet.length)]
			).join('');
			const type = RICH_TYPES[n % RICH_TYPES.length];
			expect(() => html(fence(type, body))).not.toThrow();
		}
	});

	test('containers wrap markdown; unknown, nested or invalid ones keep only their content', () => {
		const kinds = (text: string) => parseMarkdown(text).map((n) => n.kind);
		expect(kinds(':::callout{tone="success"}\nok\n:::')).toEqual(['callout']);
		expect(kinds(':::details{summary="Log"}\nx\n:::')).toEqual(['details']);
		expect(kinds(':::card{title="T" href="https://x.example"}\nx\n:::')).toEqual(['card']);
		expect(kinds(':::nope\nx\n:::')).toEqual(['paragraph']);
		expect(kinds(':::callout{tone="bad"}\nx\n:::')).toEqual(['paragraph']);
		expect(kinds(':::details\nmissing summary\n:::')).toEqual(['paragraph']);
		const nested = parseMarkdown('::::callout\nouter\n:::details{summary="s"}\ninner\n:::\n::::');
		expect(nested[0].kind).toBe('callout');
		expect(
			(nested[0] as Extract<MdBlockNode, { kind: 'callout' }>).children.map((n) => n.kind)
		).toEqual(['paragraph', 'paragraph']);
	});

	test('columns split at rules and steps number an ordered list', () => {
		const [cols] = parseMarkdown(':::columns\nA\n\n---\n\nB\n\n---\n\nC\n:::');
		expect(cols).toMatchObject({ kind: 'columns' });
		expect((cols as Extract<MdBlockNode, { kind: 'columns' }>).columns).toHaveLength(3);
		const [steps] = parseMarkdown(':::steps\n1. one\n2. two\n:::');
		expect(steps).toMatchObject({ kind: 'list', ordered: true, stepper: true });
	});

	test('a card container link follows the markdown link rule', () => {
		const [card] = parseMarkdown(':::card{title="T" href="https://app.example/x"}\nx\n:::', {
			origin: 'https://app.example'
		});
		expect(card).toMatchObject({ kind: 'card', href: null });
	});

	test('prose that looks like a directive is left alone', () => {
		const text = 'Re:thing at 10:30, mail mailto:me@x.example or :smile: and ::leaf{a=1}';
		expect(plainText(parseMarkdown(text))).toBe(text);
		const links = parseMarkdown('write to me@x.example');
		expect(JSON.stringify(links)).toContain('"kind":"link"');
	});

	test('plain text reads every block', () => {
		const text = plainText(parseMarkdown(fence('breakdown', RICH_EXAMPLES.breakdown.example)));
		expect(text).toContain('Total: 281.3 kcal/day');
		expect(text).toContain('Morning: 117.5 (42%)');
	});
});

describe('gateway check', () => {
	test('lists each invalid block with its line, and nothing for valid ones', () => {
		const text = [
			'Hi',
			fence('stats', RICH_EXAMPLES.stats.example),
			fence('bars', 'items: [{label: a, value: -1}]'),
			':::callout{tone="loud"}\nx\n:::',
			'- list\n\n  ```flow\n  steps: [{title: one}]\n  ```'
		].join('\n\n');
		const problems = lintRichMarkdown(text);
		expect(problems.map((p) => [p.block, p.messages[0]])).toEqual([
			['bars', 'items[0].value: must be ≥ 0'],
			[':::callout', 'tone: expected one of neutral, info, success, warn, danger, got "loud"'],
			['flow', 'steps: needs at least 2 items']
		]);
		expect(richRepairMessage(problems)).toContain('- bars (line ');
		expect(richRepairMessage([])).toBeNull();
	});

	test('agrees with the renderer on every block', () => {
		const samples = [
			...RICH_TYPES.map((t) => fence(t, RICH_EXAMPLES[t].example)),
			...RICH_TYPES.map((t) => fence(t, 'title: only')),
			':::steps\nnot a list\n:::'
		];
		for (const text of samples) {
			const invalidInRender = JSON.stringify(parseMarkdown(text)).includes('"invalid"');
			const fenceProblems = lintRichMarkdown(text).filter((p) => !p.block.startsWith(':::'));
			expect(fenceProblems.length > 0).toBe(invalidInRender);
		}
	});
});

describe('missed blocks', () => {
	test.each([
		['headings', '## Ingredients\n\n- rice\n\n## Method\n\n1. Cook.'],
		['bold labels', '**Ingredients:**\n- rice\n\n**Instructions:**\n1. Cook.'],
		['colon labels', 'Ingredients:\n\n- rice\n\nSteps:\n\n1. Cook.']
	])('a markdown recipe with %s is caught', (_, text) => {
		expect(missedBlocks(text)).toEqual(['recipe']);
	});

	test.each([
		[
			'a recipe block',
			fence('recipe', RICH_EXAMPLES.recipe.example) +
				'\n\n## Ingredients\n\n- x\n\n## Steps\n\n1. y'
		],
		['only ingredients', '## Ingredients\n\n- rice'],
		['prose mentioning them', 'The ingredients are rice. The steps are easy:\n\n1. Cook.'],
		['steps without ingredients', '## Steps\n\n1. Install\n2. Run']
	])('%s is left alone', (_, text) => {
		expect(missedBlocks(text)).toEqual([]);
	});

	test('the repair message names the block and its fields', () => {
		const message = richRepairMessage([], ['recipe'])!;
		expect(message).toContain('```recipe block');
		expect(message).toContain('ingredients:');
	});

	test('the prompt states the required blocks', () => {
		expect(richOutputInstructions()).toContain('- a recipe (ingredients and steps) → ```recipe');
	});
});

describe('links', () => {
	test('calendar links are built from fixed parts', () => {
		const href = calendarUrl({
			title: 'Vet & "check"',
			start: '2026-11-03T15:30',
			end: '2026-11-03T16:00',
			location: 'Clinic'
		});
		const u = new URL(href);
		expect(u.origin).toBe('https://calendar.google.com');
		expect(u.searchParams.get('dates')).toBe('20261103T153000/20261103T160000');
		expect(u.searchParams.get('text')).toBe('Vet & "check"');
		expect(
			new URL(calendarUrl({ title: 'x', start: '2026-12-31' })).searchParams.get('dates')
		).toBe('20261231/20270101');
	});

	test('maps links encode the query', () => {
		expect(new URL(mapsUrl({ name: 'A&B', address: '1 Main St' })).searchParams.get('query')).toBe(
			'A&B, 1 Main St'
		);
	});

	test('event dates read in wall-clock time', () => {
		expect(eventWhen('2026-11-03T15:30', '2026-11-03T16:00')).toEqual({
			month: 'Nov',
			day: 3,
			text: 'Tue, Nov 3, 2026 · 3:30 PM – 4:00 PM'
		});
	});
});

describe('interactive blocks', () => {
	test('durations parse only when the whole value is a duration', () => {
		expect(parseDuration('12m')).toBe(720);
		expect(parseDuration('1h30m')).toBe(5400);
		expect(parseDuration('1 hour 20 minutes')).toBe(4800);
		expect(parseDuration('90s')).toBe(90);
		expect(parseDuration('12 minutes or so')).toBeNull();
		expect(parseDuration('')).toBeNull();
		expect(parseRichBlock('timer', 'label: Tea\nduration: 4m')).toMatchObject({
			ok: true,
			block: { data: { duration: 240 } }
		});
		expect(parseRichBlock('timer', 'label: Tea\nduration: 25h').ok).toBe(false);
	});

	test('a recipe step gets the first time it names, the lower end of a range', () => {
		expect(stepDuration('Bake at 220°C for 12 minutes.')).toBe(720);
		expect(stepDuration('Simmer 10–12 min, stirring')).toBe(600);
		expect(stepDuration('Rest for 1 hour')).toBe(3600);
		expect(stepDuration('Use 2 eggs')).toBeNull();
		expect(stepDuration('Heat to 180 C')).toBeNull();
	});

	test('quantities scale to kitchen fractions and leave text alone', () => {
		expect(parseQty('1 1/2')).toBe(1.5);
		expect(parseQty('½')).toBe(0.5);
		expect(parseQty('1½')).toBe(1.5);
		expect(parseQty('a pinch')).toBeNull();
		expect(scaleQty(2, 1.5)).toBe('3');
		expect(scaleQty('1/2', 1.5)).toBe('¾');
		expect(scaleQty(1, 1 / 3)).toBe('⅓');
		expect(scaleQty('a pinch', 2)).toBe('a pinch');
		expect(scaleQty('1/2', 1)).toBe('1/2');
		expect(formatQty(12.4)).toBe('12');
		expect(formatQty(1.15)).toBe('1.2');
	});

	test('reply blocks reject what they cannot show', () => {
		expect(parseRichBlock('choice', 'question: q\noptions: [a, a]').ok).toBe(false);
		expect(parseRichBlock('actions', 'items: [a, b, c, d, e]').ok).toBe(false);
		expect(parseRichBlock('form', 'fields: [{label: x, type: select}]').ok).toBe(false);
		expect(parseRichBlock('form', 'fields: [{label: x, options: [a, b]}]').ok).toBe(false);
		expect(parseRichBlock('form', 'fields: [{label: x}, {label: x}]').ok).toBe(false);
	});

	test('reply controls are live only with a reply callback', () => {
		const text = fence('actions', RICH_EXAMPLES.actions.example);
		const stale = render(Markdown, { props: { text } }).body;
		expect(stale).toContain('Reply options work in the latest reply.');
		expect(stale.match(/<button[^>]*>/g)!.every((b) => b.includes(' disabled=""'))).toBe(true);
		const live = render(Markdown, { props: { text, reply: () => {} } }).body;
		expect(live).toContain('sends as your message');
		expect(live.match(/<button[^>]*>/g)!.some((b) => b.includes(' disabled=""'))).toBe(false);
	});

	test('tabs split at headings; fewer than two keep the content', () => {
		const [tabs] = parseMarkdown(':::tabs\nIntro\n\n## Oven\nBake.\n\n## Air fryer\nFry.\n:::');
		expect(tabs).toMatchObject({ kind: 'tabs', intro: [{ kind: 'paragraph' }] });
		expect((tabs as Extract<MdBlockNode, { kind: 'tabs' }>).tabs.map((t) => t.label)).toEqual([
			'Oven',
			'Air fryer'
		]);
		expect(parseMarkdown(':::tabs\n## Only\nx\n:::').map((n) => n.kind)).toEqual([
			'heading',
			'paragraph'
		]);
		expect(lintRichMarkdown(':::tabs\n## Only\nx\n:::')[0].messages).toEqual([
			'start each tab with a ## heading (at least 2 tabs)'
		]);
		expect(plainText(parseMarkdown(':::tabs\n## A\nx\n\n## B\ny\n:::'))).toBe('A\nx\n\nB\ny');
	});

	test('a task list keeps its id across renders, and only task lists get one', () => {
		const list = '- [ ] milk\n- [x] eggs';
		const a = parseMarkdown(`Shopping:\n\n${list}`)[1];
		const b = parseMarkdown(`Other intro\n\n${list}`)[1];
		const id = (a as { id?: string }).id;
		expect(id).toMatch(/^[0-9a-f]{8}$/);
		expect((b as { id?: string }).id).toBe(id!);
		expect(parseMarkdown('- milk')[0]).not.toHaveProperty('id');
		const out = html(list);
		expect(out.match(/data-rich-control/g)).toHaveLength(2);
		expect(out).toContain('line-through');
	});
});
