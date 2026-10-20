import {
	arr,
	bool,
	lazy,
	markOrText,
	num,
	obj,
	oneOf,
	opt,
	parsePartial,
	str,
	textOrNum,
	validate,
	type Infer,
	type Issue,
	type Schema
} from './schema';
import { parseRichYaml } from './yaml';

// The rich block catalog: one entry per fenced block type and per `:::` container. Everything else
// derives from it: the web renderer's validation, the gateway's reply check and repair message, the
// prompt section that teaches the model, and the plain-text fallback for copy and notifications.

export const TONES = ['neutral', 'info', 'success', 'warn', 'danger'] as const;
export type Tone = (typeof TONES)[number];

/** An absolute http(s) URL. The renderer still applies the markdown link rules on top. */
function url(): Schema<string> {
	const text = str({ max: 2000 });
	return {
		...text,
		parse(value, path, issues) {
			const raw = text.parse(value, path, issues);
			if (raw === undefined) return undefined;
			try {
				const u = new URL(raw);
				if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
			} catch {
				// Reported below.
			}
			issues.push({ path, message: 'expected an absolute http(s) URL' });
			return undefined;
		},
		doc: () => 'https URL'
	};
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/** `2026-10-19` or `2026-10-19T18:30`: a local date or date-time, no zone. */
function localDate(): Schema<string> {
	const text = str({ max: 25 });
	return {
		...text,
		parse(value, path, issues) {
			// YAML would not produce a Date here (core schema), but a quoted value arrives as text.
			const raw = text.parse(value, path, issues);
			if (raw === undefined) return undefined;
			const m = DATE_RE.exec(raw);
			const valid =
				m &&
				+m[2] >= 1 &&
				+m[2] <= 12 &&
				+m[3] >= 1 &&
				+m[3] <= 31 &&
				(m[4] === undefined || (+m[4] <= 23 && +m[5] <= 59 && (m[6] === undefined || +m[6] <= 59)));
			if (valid) return raw.replace(' ', 'T');
			issues.push({ path, message: 'expected a date like 2026-10-19 or 2026-10-19T18:30' });
			return undefined;
		},
		doc: () => 'YYYY-MM-DD[THH:MM]'
	};
}

const DURATION_PART =
	/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])/gi;
const DURATION_MAX_S = 24 * 3600;

/** Seconds in `1h30m`, `12 min`, `90s`, `1 hour 20 minutes`; null when it isn't only a duration. */
export function parseDuration(text: string): number | null {
	const t = text.trim().toLowerCase();
	if (!t) return null;
	let total = 0;
	let rest = t;
	for (const m of t.matchAll(DURATION_PART)) {
		const n = Number(m[1]);
		const unit = m[2][0];
		total += unit === 'h' ? n * 3600 : unit === 'm' ? n * 60 : n;
		rest = rest.replace(m[0], '');
	}
	if (rest.replace(/[\s,]|and/g, '') !== '' || total <= 0) return null;
	return Math.round(total);
}

/** The first duration a recipe step mentions (`bake for 12 minutes`), in seconds, or null. For a
 *  range (`10–12 min`) the lower bound, so the check comes early rather than late. */
export function stepDuration(text: string): number | null {
	const m =
		/(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/i.exec(
			text
		);
	if (!m) return null;
	const seconds = parseDuration(`${m[1]} ${m[2]}`);
	return seconds && seconds <= DURATION_MAX_S ? seconds : null;
}

function duration(): Schema<number> {
	const text = str({ max: 24 });
	return {
		...text,
		parse(value, path, issues) {
			if (typeof value === 'number') value = `${value}m`;
			const raw = text.parse(value, path, issues);
			if (raw === undefined) return undefined;
			const seconds = parseDuration(raw);
			if (seconds && seconds <= DURATION_MAX_S) return seconds;
			issues.push({ path, message: 'expected a duration up to 24h, like 12m, 90s or 1h30m' });
			return undefined;
		},
		doc: () => 'duration like 12m, 90s, 1h30m'
	};
}

const label = (max = 60) => str({ max });
const tone = () => opt(oneOf(TONES));

interface TreeNode {
	label: string;
	detail?: string;
	children?: TreeNode[];
}
const treeNode: Schema<TreeNode> = lazy(
	() =>
		obj({
			label: label(60),
			detail: opt(str({ max: 120 })),
			children: opt(arr(treeNode, { max: 12 }))
		}),
	'{ label, detail?, children?: [node] }'
);

const schemas = {
	breakdown: obj({
		title: opt(label(80)),
		unit: opt(str({ max: 20 })),
		segments: arr(obj({ label: label(40), value: num({ min: 0 }) }), { min: 1, max: 8 }),
		note: opt(str({ max: 280 }))
	}),
	flow: obj({
		title: opt(label(80)),
		direction: opt(oneOf(['down', 'right'] as const)),
		steps: arr(obj({ title: label(60), detail: opt(str({ max: 160 })), tone: tone() }), {
			min: 2,
			max: 8
		}),
		note: opt(str({ max: 280 }))
	}),
	stats: obj({
		title: opt(label(80)),
		items: arr(
			obj({
				label: label(40),
				value: textOrNum({ max: 24 }),
				unit: opt(str({ max: 16 })),
				delta: opt(str({ max: 24 })),
				trend: opt(oneOf(['up', 'down', 'flat'] as const)),
				good: opt(oneOf(['up', 'down'] as const))
			}),
			{ min: 1, max: 6 }
		)
	}),
	bars: obj({
		title: opt(label(80)),
		unit: opt(str({ max: 16 })),
		items: arr(obj({ label: label(40), value: num({ min: 0 }), highlight: opt(bool()) }), {
			min: 1,
			max: 12
		}),
		note: opt(str({ max: 280 }))
	}),
	line: obj(
		{
			title: opt(label(80)),
			unit: opt(str({ max: 16 })),
			points: arr(obj({ x: label(20), y: num() }), { min: 2, max: 60 }),
			note: opt(str({ max: 280 }))
		},
		(v, report) => {
			const seen = new Set<string>();
			v.points.forEach((p, i) => {
				if (seen.has(p.x)) report(`points[${i}].x`, `duplicate x "${p.x}"`);
				seen.add(p.x);
			});
		}
	),
	progress: obj({
		title: opt(label(80)),
		items: arr(
			obj(
				{
					label: label(40),
					value: num({ min: 0 }),
					max: num({ min: 0 }),
					unit: opt(str({ max: 16 }))
				},
				(v, report) => {
					if (v.max <= 0) report('max', 'must be greater than 0');
				}
			),
			{ min: 1, max: 8 }
		)
	}),
	compare: obj(
		{
			title: opt(label(80)),
			options: arr(obj({ name: label(40), note: opt(str({ max: 80 })), pick: opt(bool()) }), {
				min: 2,
				max: 4
			}),
			rows: arr(
				obj({ label: label(40), values: arr(markOrText({ max: 60 }), { min: 1, max: 4 }) }),
				{
					min: 1,
					max: 12
				}
			)
		},
		(v, report) => {
			v.rows.forEach((row, i) => {
				if (row.values.length !== v.options.length) {
					report(
						`rows[${i}].values`,
						`needs ${v.options.length} values, one per option (got ${row.values.length})`
					);
				}
			});
			if (v.options.filter((o) => o.pick).length > 1)
				report('options', 'at most one option can have pick: true');
		}
	),
	timeline: obj({
		title: opt(label(80)),
		items: arr(
			obj({ when: label(40), title: label(80), detail: opt(str({ max: 200 })), tone: tone() }),
			{
				min: 1,
				max: 20
			}
		)
	}),
	matrix: obj({
		title: opt(label(80)),
		x: obj({ low: label(24), high: label(24) }),
		y: obj({ low: label(24), high: label(24) }),
		items: arr(obj({ label: label(32), x: num({ min: 0, max: 1 }), y: num({ min: 0, max: 1 }) }), {
			min: 1,
			max: 12
		})
	}),
	tree: obj({ title: opt(label(80)), root: treeNode }, (v, report) => {
		let count = 0;
		const stack = [v.root];
		while (stack.length) {
			const n = stack.pop()!;
			count++;
			stack.push(...(n.children ?? []));
		}
		if (count > 40) report('root', `at most 40 nodes in total (got ${count})`);
	}),
	cards: obj({
		items: arr(
			obj({
				title: label(80),
				subtitle: opt(str({ max: 120 })),
				href: opt(url()),
				badge: opt(str({ max: 24 })),
				meta: opt(str({ max: 60 }))
			}),
			{ min: 1, max: 8 }
		)
	}),
	recipe: obj({
		title: label(80),
		serves: opt(num({ min: 1, max: 100 })),
		time: opt(
			obj({
				prep: opt(str({ max: 16 })),
				cook: opt(str({ max: 16 })),
				total: opt(str({ max: 16 }))
			})
		),
		ingredients: arr(
			obj({
				qty: opt(textOrNum({ max: 12 })),
				unit: opt(str({ max: 16 })),
				item: label(60),
				note: opt(str({ max: 60 }))
			}),
			{ min: 1, max: 40 }
		),
		steps: arr(str({ max: 400 }), { min: 1, max: 30 }),
		notes: opt(str({ max: 400 }))
	}),
	event: obj(
		{
			title: label(80),
			start: localDate(),
			end: opt(localDate()),
			location: opt(str({ max: 120 })),
			detail: opt(str({ max: 280 }))
		},
		(v, report) => {
			if (v.end && v.end.length !== v.start.length)
				report('end', 'must use the same form as start (date or date-time)');
			else if (v.end && v.end < v.start) report('end', 'must not be before start');
		}
	),
	place: obj({
		name: label(80),
		address: opt(str({ max: 160 })),
		detail: opt(str({ max: 200 })),
		rating: opt(num({ min: 0, max: 5 })),
		href: opt(url())
	}),
	timer: obj({ label: label(60), duration: duration() }),
	actions: obj({
		prompt: opt(str({ max: 120 })),
		items: arr(label(80), { min: 1, max: 4 })
	}),
	choice: obj(
		{
			question: label(120),
			options: arr(label(60), { min: 2, max: 8 }),
			multiple: opt(bool())
		},
		(v, report) => {
			if (new Set(v.options).size !== v.options.length)
				report('options', 'options must be different');
		}
	),
	form: obj(
		{
			title: opt(label(80)),
			fields: arr(
				obj(
					{
						label: label(40),
						type: opt(oneOf(['text', 'number', 'date', 'select'] as const)),
						options: opt(arr(label(40), { min: 2, max: 8 })),
						placeholder: opt(str({ max: 60 })),
						optional: opt(bool())
					},
					(v, report) => {
						if (v.type === 'select' && !v.options)
							report('options', 'a select field needs options');
						if (v.type !== 'select' && v.options)
							report('options', 'only a select field has options');
					}
				),
				{ min: 1, max: 6 }
			),
			submit: opt(label(30))
		},
		(v, report) => {
			const labels = v.fields.map((f) => f.label);
			if (new Set(labels).size !== labels.length)
				report('fields', 'field labels must be different');
		}
	)
} satisfies Record<string, Schema<unknown>>;

/** Blocks whose controls send a message as the owner. They are live only in the latest reply. */
export const REPLY_TYPES = new Set<string>(['actions', 'choice', 'form']);

export type RichType = keyof typeof schemas;
export type RichData<K extends RichType> = Infer<(typeof schemas)[K]>;
export type RichBlock = { [K in RichType]: { type: K; data: RichData<K> } }[RichType];
export const RICH_TYPES = Object.keys(schemas) as RichType[];

export function isRichType(lang: string | null | undefined): lang is RichType {
	return !!lang && Object.hasOwn(schemas, lang);
}

/** A fenced block's body checked against its type: the block, or the issues to report. */
export function parseRichBlock(
	type: RichType,
	body: string
): { ok: true; block: RichBlock } | { ok: false; issues: Issue[] } {
	const yaml = parseRichYaml(body);
	if (!yaml.ok) return yaml;
	const result = validate(schemas[type] as Schema<unknown>, yaml.value);
	return result.ok ? { ok: true, block: { type, data: result.value } as RichBlock } : result;
}

/** Lines dropped from the end, after the unfinished one, before a streaming body is given up on. */
const PARTIAL_RETRIES = 4;

/**
 * What a block whose fence is still streaming can show so far, or null while it can show nothing
 * (a required field such as a recipe's title hasn't arrived). Reads only whole lines, drops a few
 * more from the end while the YAML is mid-item (an open `{ label: A,`), and keeps each list's valid
 * prefix (`parsePartial`). A preview only: the closed fence goes through `parseRichBlock`, whose
 * verdict this never changes. Bounded to a few YAML parses; never throws.
 */
export function parsePartialRichBlock(type: RichType, body: string): RichBlock | null {
	let text = body.slice(0, body.lastIndexOf('\n') + 1);
	for (let attempt = 0; attempt <= PARTIAL_RETRIES && text.trim(); attempt++) {
		const yaml = parseRichYaml(text);
		if (yaml.ok) {
			const data = parsePartial(schemas[type] as Schema<unknown>, yaml.value);
			return data === undefined ? null : ({ type, data } as RichBlock);
		}
		text = text.slice(0, text.lastIndexOf('\n', text.length - 2) + 1);
	}
	return null;
}

// --- Containers -------------------------------------------------------------------------------

const containerAttrs = {
	callout: obj({ tone: tone(), title: opt(label(80)) }),
	details: obj({ summary: label(80) }),
	card: obj({ title: opt(label(80)), subtitle: opt(str({ max: 120 })), href: opt(url()) }),
	columns: obj({}),
	steps: obj({}),
	tabs: obj({})
} satisfies Record<string, Schema<unknown>>;

export type ContainerName = keyof typeof containerAttrs;
export type ContainerAttrs<K extends ContainerName> = Infer<(typeof containerAttrs)[K]>;
export const CONTAINER_NAMES = Object.keys(containerAttrs) as ContainerName[];

export function isContainerName(name: string | null | undefined): name is ContainerName {
	return !!name && Object.hasOwn(containerAttrs, name);
}

/** A container's `{key=value}` attributes, checked like a block body. */
export function parseContainerAttrs<K extends ContainerName>(
	name: K,
	attrs: Record<string, string | null | undefined>
): { ok: true; attrs: ContainerAttrs<K> } | { ok: false; issues: Issue[] } {
	const clean = Object.fromEntries(
		Object.entries(attrs).filter(([, v]) => v !== null && v !== undefined)
	);
	const result = validate(containerAttrs[name] as Schema<unknown>, clean);
	return result.ok ? { ok: true, attrs: result.value as ContainerAttrs<K> } : result;
}

// --- Prompt -----------------------------------------------------------------------------------

/** What the model is told about each block: when to use it and a valid example. Tests check that
 *  every example validates, so the prompt can't teach a shape the renderer rejects. */
export const RICH_EXAMPLES: { [K in RichType]: { use: string; example: string } } = {
	breakdown: {
		use: 'parts of a whole: a total with its share per part (calories, budget, time spent). Give raw values; the total and percentages are computed.',
		example: `title: Daily calories
unit: kcal/day
segments:
  - { label: Morning, value: 117.5 }
  - { label: Evening dry, value: 78.3 }
  - { label: Evening wet, value: 85.5 }`
	},
	flow: {
		use: 'an ordered process, pipeline or priority order, top to bottom (or left to right).',
		example: `title: Bankruptcy repayment priority
steps:
  - { title: Secured creditors, detail: Claims against collateral, tone: success }
  - { title: Unsecured creditors, detail: Including most bondholders, tone: warn }
  - { title: Shareholders, detail: Usually last, tone: danger }
note: Actual priority depends on jurisdiction.`
	},
	stats: {
		use: 'a few headline numbers, optionally with a change.',
		example: `items:
  - { label: Weight, value: 5.1, unit: kg, delta: -0.2 kg, trend: down, good: down }
  - { label: Daily food, value: 281, unit: kcal }`
	},
	bars: {
		use: 'comparing one number across a few labelled things (ranking, spend per category).',
		example: `title: Spend by category
unit: $
items:
  - { label: Food, value: 412 }
  - { label: Travel, value: 230, highlight: true }`
	},
	line: {
		use: 'one value over time or over an ordered axis.',
		example: `title: Weight
unit: kg
points:
  - { x: Jan, y: 5.4 }
  - { x: Feb, y: 5.2 }
  - { x: Mar, y: 5.1 }`
	},
	progress: {
		use: 'values against a target or limit (goals, quotas, budgets).',
		example: `items:
  - { label: Savings, value: 3200, max: 5000, unit: $ }`
	},
	compare: {
		use: 'options side by side across the same attributes; true/false render as ✓/✗.',
		example: `options:
  - { name: Plan A, note: $10/mo }
  - { name: Plan B, note: $15/mo, pick: true }
rows:
  - { label: Offline, values: [false, true] }
  - { label: Seats, values: ["1", "5"] }`
	},
	timeline: {
		use: 'dated or ordered events: history, an itinerary, a schedule.',
		example: `items:
  - { when: "09:00", title: Ferry to Orcas, detail: Arrive 30 min early }
  - { when: "12:30", title: Lunch in Eastsound }`
	},
	matrix: {
		use: 'items placed on two axes (2×2), x and y from 0 to 1.',
		example: `x: { low: Low effort, high: High effort }
y: { low: Low impact, high: High impact }
items:
  - { label: Fix login bug, x: 0.2, y: 0.9 }`
	},
	tree: {
		use: 'a hierarchy: org chart, taxonomy, folder layout.',
		example: `root:
  label: Gateway
  children:
    - { label: Web app }
    - label: Workspace
      children: [{ label: Agent }, { label: Browser }]`
	},
	cards: {
		use: 'a few links or items worth scanning: articles, PRs, products.',
		example: `items:
  - { title: "PR #412 merged", subtitle: Topic mutes, href: "https://github.com/example/repo/pull/412", badge: deployed }`
	},
	recipe: {
		use: 'a cooking recipe.',
		example: `title: Miso butter salmon
serves: 2
time: { prep: 10 min, cook: 12 min }
ingredients:
  - { qty: 2, unit: fillets, item: salmon }
  - { qty: 1, unit: tbsp, item: white miso }
steps:
  - Mix the miso with softened butter.
  - Spread on the salmon and bake at 220°C for 12 minutes.`
	},
	event: {
		use: 'one event with a date (adds a calendar link).',
		example: `title: Vet check-up
start: 2026-11-03T15:30
end: 2026-11-03T16:00
location: Eastside Animal Clinic`
	},
	place: {
		use: 'one place (adds a maps link).',
		example: `name: Eastside Animal Clinic
address: 123 Main St, Seattle, WA
rating: 4.7`
	},
	timer: {
		use: 'a countdown the owner can start (steeping, resting, a break).',
		example: `label: Steep the tea
duration: 4m`
	},
	actions: {
		use: 'up to 4 likely next replies as buttons; a tap sends the label as the owner’s message. Last block of the reply only.',
		example: `prompt: Want me to adjust it?
items:
  - Make it vegetarian
  - Scale to 6 servings`
	},
	choice: {
		use: 'a question with options to pick (multiple: true for several); the picks are sent as the owner’s message. Last block of the reply only.',
		example: `question: Which day works for the vet?
options: [Monday, Tuesday, Thursday]`
	},
	form: {
		use: 'a few details you need before you can continue; the filled-in values are sent as the owner’s message. Last block of the reply only.',
		example: `title: Trip details
fields:
  - { label: Dates, placeholder: e.g. Nov 7–9 }
  - { label: People, type: number }
  - { label: Budget, type: select, options: [Low, Medium, High], optional: true }
submit: Plan it`
	}
};

/** What must always be a block. Firm rules, because "use when clearer" alone is easy for a model
 *  to skip, and the gateway backs the recipe rule with a check (`missedBlocks` in syntax.ts). */
export const RICH_RULES: readonly [string, string][] = [
	['a recipe (ingredients and steps)', '```recipe'],
	[
		'a question for the owner with a few possible answers',
		'```choice (or ```actions for suggested next steps)'
	],
	['details you need from the owner before continuing', '```form'],
	['a total split into parts or shares', '```breakdown'],
	['2–4 options compared across the same attributes', '```compare'],
	['one dated event or appointment', '```event'],
	['a schedule or itinerary with times or dates', '```timeline'],
	['a countdown the owner asked for', '```timer']
];

/** The prompt section: the two syntax rules, then each block with its fields and an example. */
export function richOutputInstructions(): string {
	const fence = '```';
	const blocks = RICH_TYPES.map((type) => {
		const { use, example } = RICH_EXAMPLES[type];
		return `- \`${type}\`: ${use}\n  Fields: ${schemas[type].doc()}\n${fence}${type}\n${example}\n${fence}`;
	}).join('\n');
	const containers = CONTAINER_NAMES.map(
		(name) => `\`${name}\` ${containerAttrs[name].doc()}`
	).join('; ');
	return [
		'Rich output: the web chat renders these blocks; elsewhere they read as plain text. Keep prose around them short.',
		[
			'Required: when a reply contains one of these, write it as the block, never as markdown headings, lists or tables:',
			...RICH_RULES.map(([what, block]) => `- ${what} → ${block}`),
			'Other blocks are optional: use them when they make the answer clearer than prose, not for decoration.'
		].join('\n'),
		`1. Data blocks: a fenced code block whose language is the block type, with a YAML body. Only plain YAML: no anchors, aliases or tags. Unknown or misspelled fields are errors. Values the renderer computes (totals, percentages) are not fields.`,
		blocks,
		`2. Containers wrap ordinary markdown in \`:::name{key="value"}\` … \`:::\`, one level only (never nest them): ${containers}. tone is one of ${TONES.join('|')}. In \`columns\`, a line with \`---\` starts the next column; in \`steps\`, write an ordered list; in \`tabs\`, each \`##\` heading starts a tab.`,
		':::callout{tone="warn" title="Heads up"}\nThe ferry fills up on Fridays.\n:::',
		'Interactive: task lists (- [ ] item) can be ticked by the owner; recipe steps that mention a time get a timer. actions, choice and form send the owner’s answer as their next message, so ask with them instead of asking in prose, and put them last.',
		'After your reply, each block is checked. If one is invalid you will get the exact errors and write the reply again with them fixed.'
	].join('\n\n');
}

// --- Plain text -------------------------------------------------------------------------------

const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const TENTHS = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
/** Tenths below 1,000 and whole numbers above, so a list of values reads consistently. */
const fmt = (n: number) => (Math.abs(n) >= 1000 ? WHOLE : TENTHS).format(n);

/** Percentages that sum to exactly 100 (largest remainder), for a breakdown's legend. */
export function shares(values: readonly number[]): number[] {
	const total = values.reduce((a, b) => a + b, 0);
	if (total <= 0) return values.map(() => 0);
	const raw = values.map((v) => (v / total) * 100);
	const floors = raw.map(Math.floor);
	let left = 100 - floors.reduce((a, b) => a + b, 0);
	const order = raw
		.map((r, i) => [r - floors[i], i] as const)
		.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
	for (const [, i] of order) {
		if (left <= 0) break;
		floors[i]++;
		left--;
	}
	return floors;
}

export function formatNumber(n: number): string {
	return fmt(n);
}

const PREFIX_UNITS = new Set(['$', '€', '£', '¥', '₩', '₹']);

/** `$412`, `5.1 kg`, `412`: a number with its unit on the side the unit is read. */
export function withUnit(n: number, unit?: string): string {
	if (!unit) return fmt(n);
	return PREFIX_UNITS.has(unit) ? `${unit}${fmt(n)}` : `${fmt(n)} ${unit}`;
}

const mark = (v: string | boolean) => (v === true ? 'yes' : v === false ? 'no' : v);

/** A block as readable text, for Copy, read-aloud and anywhere that can't render it. */
export function richPlainText(block: RichBlock): string {
	const lines: string[] = [];
	const push = (...s: (string | undefined | false)[]) =>
		lines.push(...s.filter((x): x is string => !!x));
	switch (block.type) {
		case 'breakdown': {
			const d = block.data;
			const total = d.segments.reduce((a, s) => a + s.value, 0);
			const pct = shares(d.segments.map((s) => s.value));
			push(d.title, `Total: ${withUnit(total, d.unit)}`);
			d.segments.forEach((s, i) => push(`- ${s.label}: ${fmt(s.value)} (${pct[i]}%)`));
			push(d.note);
			break;
		}
		case 'flow':
			push(block.data.title);
			block.data.steps.forEach((s, i) =>
				push(`${i + 1}. ${s.title}${s.detail ? ` — ${s.detail}` : ''}`)
			);
			push(block.data.note);
			break;
		case 'stats':
			push(block.data.title);
			for (const s of block.data.items) {
				push(
					`${s.label}: ${s.value}${s.unit ? ' ' + s.unit : ''}${s.delta ? ` (${s.delta})` : ''}`
				);
			}
			break;
		case 'bars':
			push(block.data.title);
			for (const s of block.data.items) push(`- ${s.label}: ${withUnit(s.value, block.data.unit)}`);
			push(block.data.note);
			break;
		case 'line':
			push(block.data.title);
			push(block.data.points.map((p) => `${p.x}: ${withUnit(p.y, block.data.unit)}`).join(', '));
			push(block.data.note);
			break;
		case 'progress':
			push(block.data.title);
			for (const s of block.data.items) {
				push(
					`- ${s.label}: ${withUnit(s.value, s.unit)} of ${withUnit(s.max, s.unit)} (${Math.round((s.value / s.max) * 100)}%)`
				);
			}
			break;
		case 'compare': {
			const d = block.data;
			push(d.title, ['', ...d.options.map((o) => o.name + (o.pick ? ' (pick)' : ''))].join('\t'));
			for (const r of d.rows) push([r.label, ...r.values.map(mark)].join('\t'));
			break;
		}
		case 'timeline':
			push(block.data.title);
			for (const s of block.data.items)
				push(`- ${s.when}: ${s.title}${s.detail ? ` — ${s.detail}` : ''}`);
			break;
		case 'matrix': {
			const d = block.data;
			push(d.title, `x: ${d.x.low} → ${d.x.high}; y: ${d.y.low} → ${d.y.high}`);
			for (const s of d.items) {
				push(`- ${s.label}: ${s.x < 0.5 ? d.x.low : d.x.high}, ${s.y < 0.5 ? d.y.low : d.y.high}`);
			}
			break;
		}
		case 'tree': {
			push(block.data.title);
			const walk = (n: TreeNode, depth: number) => {
				push(`${'  '.repeat(depth)}- ${n.label}${n.detail ? ` — ${n.detail}` : ''}`);
				for (const c of n.children ?? []) walk(c, depth + 1);
			};
			walk(block.data.root, 0);
			break;
		}
		case 'cards':
			for (const c of block.data.items) {
				push(`- ${c.title}${c.subtitle ? ` — ${c.subtitle}` : ''}${c.href ? ` (${c.href})` : ''}`);
			}
			break;
		case 'recipe': {
			const d = block.data;
			const time = d.time
				? Object.entries(d.time)
						.map(([k, v]) => `${k} ${v}`)
						.join(', ')
				: '';
			push(
				d.title,
				[d.serves ? `Serves ${d.serves}` : '', time].filter(Boolean).join(' · ') || undefined,
				'Ingredients:'
			);
			for (const i of d.ingredients) {
				push(
					`- ${[i.qty, i.unit, i.item].filter((x) => x !== undefined).join(' ')}${i.note ? `, ${i.note}` : ''}`
				);
			}
			push('Steps:');
			d.steps.forEach((s, i) => push(`${i + 1}. ${s}`));
			push(d.notes);
			break;
		}
		case 'event':
			push(
				block.data.title,
				`${block.data.start.replace('T', ' ')}${block.data.end ? ` – ${block.data.end.replace('T', ' ')}` : ''}`,
				block.data.location,
				block.data.detail
			);
			break;
		case 'place':
			push(
				block.data.name,
				block.data.address,
				block.data.rating !== undefined ? `Rating ${block.data.rating}` : undefined,
				block.data.detail
			);
			break;
		case 'timer':
			push(`${block.data.label}: ${formatDuration(block.data.duration)}`);
			break;
		case 'actions':
			push(block.data.prompt);
			for (const item of block.data.items) push(`- ${item}`);
			break;
		case 'choice':
			push(block.data.question);
			for (const option of block.data.options) push(`- ${option}`);
			break;
		case 'form':
			push(block.data.title);
			for (const f of block.data.fields)
				push(`- ${f.label}${f.options ? ` (${f.options.join(', ')})` : ''}`);
			break;
	}
	return lines.join('\n');
}

/** `4:00`, `1:30:00`: seconds as a clock reading. */
export function formatDuration(seconds: number): string {
	const s = Math.max(0, Math.round(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = String(s % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Issues as one line each, `segments[2].value: expected a number`. */
export function formatIssues(issues: readonly Issue[]): string[] {
	return issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message));
}

export const RICH_SCHEMAS: Readonly<Record<RichType, Schema<unknown>>> = schemas;
