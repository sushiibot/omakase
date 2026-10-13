// Reports markup that drifts from stock shadcn-svelte nova and the shared screen primitives
// (docs/ux-guidelines.md, "Reach and touch targets", "Type scale" and "Shared component patterns").
import { parse } from 'svelte/compiler';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { modeFromEnv, reportDrift, type DriftMode, type DriftViolation } from './ui-drift-mode';

export interface Violation {
	file: string;
	line: number;
	rule: string;
}

const UI = 'src/lib/ui/';
const FEATURES = 'src/lib/features/';
const ROUTES = 'src/routes/';

const RULE = {
	touchSize:
		'fixed touch size on a control outside lib/ui; paint stock sizes and let the hit area extend',
	buttonSize: 'Button size compact, action or icon-lg; use a nova size',
	buttonClass: 'size-12 on a Button; let the coarse-pointer hit area extend it',
	buttonLg: 'Button size lg outside sheet decisions and approvals',
	header: '<h1> or <header> outside the page header and shell',
	h2: '<h2> in a feature or route; use Section, Sheet.Title or Card.Title',
	screenRoot: 'screen root is not Page, ListScreen, DetailScreen, TabbedScreen or a screen',
	routeRoot: 'route does not render a feature screen at its root',
	maxWidth: 'raw max-w-* in a feature; the screen primitive owns the measure',
	rawControl: 'raw <button>, <input>, <select> or <textarea> in a feature; use lib/ui',
	syncShape: 'SYNC.json must be an object of { "<component>": { "drift": ... } }',
	syncMissing: 'stock-named lib/ui dir without a SYNC.json entry',
	syncOrphan: 'SYNC.json entry without a stock-named lib/ui dir',
	syncReason: 'SYNC.json drift reason must be "none" or cite (ux-guidelines.md#<anchor>)',
	syncAnchor: 'SYNC.json drift reason cites a missing ux-guidelines.md anchor',
	syncHeader: 'stock-named lib/ui file without its shadcn-svelte nova header'
};

export const LARGE_TARGET_FILES = new Set([
	// The composer's send and attach controls sit at the thumb edge on phones.
	'src/lib/features/chat/components/composer.svelte',
	// The voice panel's call controls are used hands-busy, mid-conversation.
	'src/lib/features/chat/components/voice-panel.svelte'
]);

export const LG_ALLOWED = new Set([
	// Sheet decision bodies: the confirming action is the sheet's whole purpose.
	'src/lib/features/threads/components/branch-sheet.svelte',
	'src/lib/features/threads/components/thread-settings-sheet.svelte',
	// Approval decisions, where a mis-tap is costly.
	'src/lib/features/chat/components/approval-tray.svelte',
	'src/lib/features/chat/components/approval-inline.svelte',
	'src/lib/features/chat/components/tool-confirmation.svelte',
	'src/lib/features/agents/components/approval-card.svelte'
]);

export const H2_FILES = new Set([
	// Transcript cards are articles in the conversation, each with its own heading.
	'src/lib/features/chat/components/conversation.svelte',
	'src/lib/features/chat/components/approval-tray.svelte',
	'src/lib/features/chat/components/approval-inline.svelte',
	'src/lib/features/chat/components/tool-confirmation.svelte',
	'src/lib/features/agents/components/approval-card.svelte'
]);
/** Markdown renders the author's own headings, h1 included. */
const MARKDOWN_RENDER = `${FEATURES}chat/render/`;

export const RAW_CONTROL_FILES = new Set([
	// The composer's textarea, file input and send controls are custom-built around the keyboard.
	'src/lib/features/chat/components/composer.svelte'
]);

export const ROUTE_ROOT_ALLOWED = new Set([
	// The split workspace that hosts a chat screen beside the task inspector.
	'TaskWorkspace',
	// Renders nothing; it clears shown notifications while the chat is visible.
	'ClearNotifications'
]);

/** Sheets and dialogs portal out of the layout, so they may sit beside the screen root. */
const isOverlay = (name: string) => /(?:Sheet|Dialog|Drawer)(?:\.Root)?$/.test(name);
/** ListScreen, DetailScreen, TabbedScreen, or another feature's screen; never the bare Screen. */
const isScreenRoot = (name: string) =>
	/^Page(\.|$)/.test(name) || (/Screen$/.test(name) && name !== 'Screen');

const TOUCH_SIZE = /(?<![\w-])(?:min-h|h|size)-1[2-6](?![\w-])/;
const MAX_WIDTH = /(?<![\w-])max-w-(?!(?:prose|full|none)(?![\w-])|\[85%\])[\w[\].%-]+/;
const INTERACTIVE_TAGS = /^(a|button|input|select|textarea|summary)$/;

interface Node {
	type: string;
	start: number;
	end: number;
	name?: string;
	[key: string]: unknown;
}

const isNode = (v: unknown): v is Node =>
	typeof v === 'object' && v !== null && typeof (v as Node).type === 'string';

function walk(value: unknown, visit: (node: Node) => void): void {
	if (Array.isArray(value)) {
		for (const item of value) walk(item, visit);
	} else if (typeof value === 'object' && value !== null) {
		if (isNode(value)) visit(value);
		for (const [key, child] of Object.entries(value)) if (key !== 'metadata') walk(child, visit);
	}
}

const IGNORED_ROOTS = new Set([
	'Comment',
	'SnippetBlock',
	'ConstTag',
	'SvelteHead',
	'SvelteWindow',
	'SvelteDocument',
	'SvelteBody',
	'SvelteOptions'
]);
const BRANCHES = [
	'consequent',
	'alternate',
	'body',
	'fallback',
	'fragment',
	'pending',
	'then',
	'catch'
];

/** The rendered top-level nodes of a fragment, looking through control-flow blocks and boundaries. */
function roots(nodes: Node[]): Node[] {
	return nodes.flatMap((node): Node[] => {
		if (node.type === 'Text') return String(node.data).trim() ? [node] : [];
		if (IGNORED_ROOTS.has(node.type)) return [];
		if (/Block$/.test(node.type) || node.type === 'SvelteBoundary') {
			return BRANCHES.flatMap((key) => {
				const branch = node[key] as { nodes?: Node[] } | null | undefined;
				return branch?.nodes ? roots(branch.nodes) : [];
			});
		}
		return [node];
	});
}

export function checkSvelte(file: string, source: string): Violation[] {
	if (!file.endsWith('.svelte')) return [];
	const out: Violation[] = [];
	const lineOf = (offset: number) => source.slice(0, offset).split('\n').length;
	const add = (offset: number, rule: string) => out.push({ file, line: lineOf(offset), rule });
	const ast = parse(source, { filename: file, modern: true });
	const inUi = file.startsWith(UI);
	const inFeature = file.startsWith(FEATURES);
	const inMarkup = inFeature || file.startsWith(ROUTES);
	const inMarkdown = file.startsWith(MARKDOWN_RENDER);

	walk(ast.fragment, (node) => {
		if (inFeature && (node.type === 'Attribute' || node.type === 'ClassDirective')) {
			if (MAX_WIDTH.test(source.slice(node.start, node.end))) add(node.start, RULE.maxWidth);
		}
		if (node.type !== 'Component' && node.type !== 'RegularElement') return;
		const attrs = (node.attributes as Node[] | undefined) ?? [];
		const has = (name: string) => attrs.some((a) => a.type === 'Attribute' && a.name === name);
		const attrText = (name: string) =>
			attrs
				.filter((a) => a.type === 'Attribute' && a.name === name)
				.map((a) => source.slice(a.start, a.end))
				.join(' ');
		const classText = [
			attrText('class'),
			...attrs.filter((a) => a.type === 'ClassDirective').map((a) => `class:${a.name}`)
		].join(' ');
		const isButton = node.type === 'Component' && node.name === 'Button';

		if (isButton && !file.startsWith(`${UI}button/`)) {
			if (/['"](?:compact|action|icon-lg)['"]/.test(attrText('size')))
				add(node.start, RULE.buttonSize);
			if (/(?<![\w-])size-12(?![\w-])/.test(classText)) add(node.start, RULE.buttonClass);
			if (/['"]lg['"]/.test(attrText('size')) && !inUi && !LG_ALLOWED.has(file))
				add(node.start, RULE.buttonLg);
		}

		const interactive =
			isButton ||
			has('onclick') ||
			has('href') ||
			/^(button|link|tab|switch|checkbox|menuitem)$/.test(
				attrText('role').replace(/^role=["']?|["']$/g, '')
			) ||
			(node.type === 'RegularElement' && INTERACTIVE_TAGS.test(node.name ?? ''));
		if (interactive && !inUi && !LARGE_TARGET_FILES.has(file)) {
			const sizing = isButton ? classText.replace(/(?<![\w-])size-12(?![\w-])/g, '') : classText;
			if (TOUCH_SIZE.test(sizing)) add(node.start, RULE.touchSize);
		}

		if (node.type !== 'RegularElement' || !inMarkup) return;
		if ((node.name === 'h1' || node.name === 'header') && !inMarkdown) add(node.start, RULE.header);
		if (node.name === 'h2' && !inMarkdown && !H2_FILES.has(file)) add(node.start, RULE.h2);
		if (
			inFeature &&
			/^(button|input|select|textarea)$/.test(node.name ?? '') &&
			!RAW_CONTROL_FILES.has(file)
		)
			add(node.start, RULE.rawControl);
	});

	const top = roots(ast.fragment.nodes as unknown as Node[]);
	const component = (n: Node, ok: (name: string) => boolean) =>
		n.type === 'Component' && ok(n.name ?? '');
	const layout = top.filter((n) => !component(n, isOverlay));
	if (inFeature && file.endsWith('-screen.svelte')) {
		const bad = layout.find((n) => !component(n, isScreenRoot));
		if (bad || !layout.length) add(bad?.start ?? 0, RULE.screenRoot);
	}
	if (/^src\/routes\/(.+\/)?\+page\.svelte$/.test(file)) {
		const bad = layout.find(
			(n) => !component(n, (name) => isScreenRoot(name) || ROUTE_ROOT_ALLOWED.has(name))
		);
		if (bad) add(bad.start, RULE.routeRoot);
	}
	return out;
}

/** Component names in the shadcn-svelte nova registry (registry:ui). */
export const STOCK_NAMES = new Set([
	'accordion',
	'alert',
	'alert-dialog',
	'aspect-ratio',
	'attachment',
	'avatar',
	'badge',
	'breadcrumb',
	'bubble',
	'button',
	'button-group',
	'calendar',
	'card',
	'carousel',
	'chart',
	'checkbox',
	'collapsible',
	'command',
	'context-menu',
	'dialog',
	'drawer',
	'dropdown-menu',
	'empty',
	'field',
	'form',
	'hover-card',
	'input',
	'input-group',
	'input-otp',
	'item',
	'kbd',
	'label',
	'marker',
	'menubar',
	'message',
	'message-scroller',
	'native-select',
	'navigation-menu',
	'pagination',
	'popover',
	'progress',
	'questionnaire',
	'radio-group',
	'range-calendar',
	'resizable',
	'scroll-area',
	'select',
	'separator',
	'sheet',
	'sidebar',
	'skeleton',
	'slider',
	'sonner',
	'spinner',
	'switch',
	'table',
	'tabs',
	'textarea',
	'toggle',
	'toggle-group',
	'tooltip'
]);

export const LOCAL_FILES = new Set([
	// App-specific parts that live beside the stock component they build on; no nova source.
	'input/search-field.svelte',
	'radio-group/radio-group-card.svelte',
	'sheet/routed-sheet.svelte',
	'switch/switch-row.svelte',
	'tabs/swipeable-tabs.svelte',
	'tabs/index.ts'
]);

/** GitHub-style heading anchors of a markdown document, ignoring fenced code. */
export function anchors(markdown: string): Set<string> {
	const out = new Set<string>();
	const seen = new Map<string, number>();
	const prose = markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');
	for (const [, text] of prose.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
		const slug = text
			.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s_-]/gu, '')
			.replace(/\s/g, '-');
		const n = seen.get(slug) ?? 0;
		seen.set(slug, n + 1);
		out.add(n ? `${slug}-${n}` : slug);
	}
	return out;
}

/** `dirs` maps each stock-named lib/ui dir to its files' sources. */
export function checkSync(
	dirs: Record<string, Record<string, string>>,
	syncJson: string,
	guidelines: string
): DriftViolation[] {
	const out: DriftViolation[] = [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(syncJson);
	} catch {
		parsed = null;
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return [{ where: 'src/lib/ui/SYNC.json', rule: RULE.syncShape }];
	}
	const sync = parsed as Record<string, { drift?: unknown } | null>;
	const known = anchors(guidelines);
	for (const dir of Object.keys(dirs)) {
		if (!(dir in sync)) out.push({ where: `src/lib/ui/${dir}`, rule: RULE.syncMissing });
	}
	for (const [name, entry] of Object.entries(sync)) {
		const where = `src/lib/ui/SYNC.json ${name}`;
		if (!(name in dirs)) out.push({ where, rule: RULE.syncOrphan });
		const drift = entry?.drift;
		if (drift === 'none') continue;
		const cited =
			typeof drift === 'string'
				? [...drift.matchAll(/\(ux-guidelines\.md#([\w-]+)\)/g)].map((m) => m[1])
				: [];
		if (!cited.length) out.push({ where, rule: RULE.syncReason });
		for (const anchor of cited.filter((c) => !known.has(c)))
			out.push({ where: `${where} #${anchor}`, rule: RULE.syncAnchor });
	}
	for (const [dir, files] of Object.entries(dirs)) {
		for (const [file, source] of Object.entries(files)) {
			if (LOCAL_FILES.has(`${dir}/${file}`)) continue;
			const path = `ui/${dir}/${file}`.replace(/[.]/g, '\\.');
			const header = file.endsWith('.svelte')
				? new RegExp(`^<!-- shadcn-svelte nova: ${path}( @ \\S+)? -->$`)
				: new RegExp(`^// shadcn-svelte nova: ${path}( @ \\S+)?$`);
			if (!header.test(source.split('\n', 1)[0].trim())) {
				out.push({ where: `src/lib/ui/${dir}/${file}`, rule: RULE.syncHeader });
			}
		}
	}
	return out;
}

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return name === 'proto-routes' ? [] : files(path);
		return name.endsWith('.svelte') ? [path] : [];
	});
}

export function readStockDirs(uiDir: string): Record<string, Record<string, string>> {
	const out: Record<string, Record<string, string>> = {};
	for (const name of readdirSync(uiDir)) {
		const dir = join(uiDir, name);
		if (!STOCK_NAMES.has(name) || !statSync(dir).isDirectory()) continue;
		out[name] = Object.fromEntries(
			readdirSync(dir)
				.filter((f) => /\.(svelte|ts)$/.test(f) && !f.endsWith('.test.ts'))
				.map((f) => [f, readFileSync(join(dir, f), 'utf8')])
		);
	}
	return out;
}

/** Checks every component under root/src plus SYNC.json, and returns the exit code. */
export function run(root: string, mode: DriftMode, log = console.error, ok = console.log): number {
	const ui = join(root, 'src/lib/ui');
	const syncPath = join(ui, 'SYNC.json');
	const violations: DriftViolation[] = files(join(root, 'src'))
		.flatMap((path) =>
			checkSvelte(relative(root, path).replace(/\\/g, '/'), readFileSync(path, 'utf8'))
		)
		.map((v) => ({ where: `${v.file}:${v.line}`, rule: v.rule }));
	violations.push(
		...checkSync(
			existsSync(ui) ? readStockDirs(ui) : {},
			existsSync(syncPath) ? readFileSync(syncPath, 'utf8') : '{}',
			readFileSync(join(root, 'docs/ux-guidelines.md'), 'utf8')
		)
	);
	if (!violations.length) ok('UI follows stock nova and the shared screens');
	return reportDrift('check-ui-drift', violations, mode, log);
}

if (import.meta.main) process.exit(run(join(import.meta.dir, '..'), modeFromEnv()));
