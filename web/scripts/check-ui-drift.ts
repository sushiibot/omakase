// Reports markup that drifts from stock shadcn-svelte nova and the shared screen primitives
// (docs/ux-guidelines.md, "Reach and touch targets", "Type scale" and "Shared component patterns").
import { parse } from 'svelte/compiler';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { reportDrift, strict, type DriftViolation } from './ui-drift-mode';

export interface Violation {
	file: string;
	line: number;
	rule: string;
}

const FEATURES = 'src/lib/features/';
const ROUTES = 'src/routes/';

const RULE = {
	buttonSize: 'Button size compact, action or icon-lg; use a nova size',
	buttonClass: 'size-12 on a Button; let the coarse-pointer hit area extend it',
	header: '<h1> or <header> outside the page header and shell',
	h2: '<h2> in a feature; use Section, Sheet.Title or Card.Title',
	screenRoot: 'screen root is not Page, ListScreen, DetailScreen, TabbedScreen or a screen',
	routeMarkup: 'route renders markup; render a feature screen',
	maxWidth: 'raw max-w-* in a feature; the screen primitive owns the measure',
	rawControl: 'raw <button>, <input>, <select> or <textarea> in a feature; use lib/ui',
	syncMissing: 'stock-named lib/ui dir without a SYNC.json entry',
	syncOrphan: 'SYNC.json entry without a stock-named lib/ui dir',
	syncReason: 'SYNC.json drift reason must be "none" or cite (ux-guidelines.md#<anchor>)',
	syncAnchor: 'SYNC.json drift reason cites a missing ux-guidelines.md anchor',
	syncHeader: 'stock-named lib/ui file without its shadcn-svelte nova header'
};

export const HEADING_FILES = new Set([
	// Transcript cards are articles in the conversation, each with its own heading.
	'src/lib/features/chat/components/conversation.svelte',
	'src/lib/features/chat/components/approval-tray.svelte',
	'src/lib/features/chat/components/approval-inline.svelte',
	'src/lib/features/chat/components/tool-confirmation.svelte',
	'src/lib/features/agents/components/approval-card.svelte'
]);
/** Markdown renders the author's own headings. */
const MARKDOWN_RENDER = `${FEATURES}chat/render/`;

export const RAW_CONTROL_FILES = new Set([
	// The composer's textarea, file input and send controls are custom-built around the keyboard.
	'src/lib/features/chat/components/composer.svelte'
]);

/** Sheets portal out of the layout, so they may sit beside the screen root. */
const isOverlay = (name: string) => /Sheet(\.Root)?$/.test(name);
/** ListScreen, DetailScreen, TabbedScreen, or another feature's screen; never the bare Screen. */
const isScreenRoot = (name: string) =>
	/^Page(\.|$)/.test(name) || (/Screen$/.test(name) && name !== 'Screen');

const MAX_WIDTH = /(?<![\w-])max-w-(?:xs|sm|md|lg|xl|[2-7]xl)\b/;

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

/** The rendered top-level nodes of a fragment, looking through control-flow blocks. */
function roots(nodes: Node[]): Node[] {
	return nodes.flatMap((node): Node[] => {
		if (node.type === 'Text') return String(node.data).trim() ? [node] : [];
		if (IGNORED_ROOTS.has(node.type)) return [];
		if (/Block$/.test(node.type)) {
			const branches = [
				'consequent',
				'alternate',
				'body',
				'fallback',
				'fragment',
				'pending',
				'then',
				'catch'
			];
			return branches.flatMap((key) => {
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
	const inFeature = file.startsWith(FEATURES);
	const inMarkup = inFeature || file.startsWith(ROUTES);
	const headingsAllowed = HEADING_FILES.has(file) || file.startsWith(MARKDOWN_RENDER);

	walk(ast.fragment, (node) => {
		const attrs = (node.attributes as Node[] | undefined) ?? [];
		const attrText = (name: string) =>
			attrs
				.filter((a) => a.type === 'Attribute' && a.name === name)
				.map((a) => source.slice(a.start, a.end))
				.join(' ');
		if (
			node.type === 'Component' &&
			node.name === 'Button' &&
			!file.startsWith('src/lib/ui/button/')
		) {
			if (/['"](?:compact|action|icon-lg)['"]/.test(attrText('size')))
				add(node.start, RULE.buttonSize);
			if (/(?<![\w-])size-12\b/.test(attrText('class'))) add(node.start, RULE.buttonClass);
		}
		if (node.type !== 'RegularElement' || !inMarkup) return;
		if ((node.name === 'h1' || node.name === 'header') && !headingsAllowed)
			add(node.start, RULE.header);
		if (node.name === 'h2' && !headingsAllowed) add(node.start, RULE.h2);
		if (
			inFeature &&
			/^(button|input|select|textarea)$/.test(node.name ?? '') &&
			!RAW_CONTROL_FILES.has(file)
		)
			add(node.start, RULE.rawControl);
	});

	const top = roots(ast.fragment.nodes as unknown as Node[]);
	if (inFeature && file.endsWith('-screen.svelte')) {
		const layout = top.filter((n) => !(n.type === 'Component' && isOverlay(n.name ?? '')));
		const bad = layout.find((n) => !(n.type === 'Component' && isScreenRoot(n.name ?? '')));
		if (bad || !layout.length) add(bad?.start ?? 0, RULE.screenRoot);
	}
	if (/^src\/routes\/(.+\/)?\+page\.svelte$/.test(file)) {
		const bad = top.find((n) => n.type !== 'Component');
		if (bad) add(bad.start, RULE.routeMarkup);
	}
	if (inFeature) {
		source.split('\n').forEach((text, i) => {
			if (MAX_WIDTH.test(text)) out.push({ file, line: i + 1, rule: RULE.maxWidth });
		});
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
	'tabs/swipeable-tabs.svelte'
]);

/** GitHub-style heading anchors of a markdown document. */
export function anchors(markdown: string): Set<string> {
	const out = new Set<string>();
	const seen = new Map<string, number>();
	for (const [, text] of markdown.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
		const slug = text
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
	const sync = JSON.parse(syncJson) as Record<string, { drift?: unknown }>;
	const known = anchors(guidelines);
	for (const dir of Object.keys(dirs)) {
		if (!(dir in sync)) out.push({ where: `src/lib/ui/${dir}`, rule: RULE.syncMissing });
	}
	for (const [name, entry] of Object.entries(sync)) {
		const where = `src/lib/ui/SYNC.json ${name}`;
		if (!(name in dirs)) out.push({ where, rule: RULE.syncOrphan });
		const drift = entry?.drift;
		if (drift === 'none') continue;
		const cited = typeof drift === 'string' && drift.match(/\(ux-guidelines\.md#([\w-]+)\)/);
		if (!cited) out.push({ where, rule: RULE.syncReason });
		else if (!known.has(cited[1]))
			out.push({ where: `${where} #${cited[1]}`, rule: RULE.syncAnchor });
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

if (import.meta.main) {
	const root = join(import.meta.dir, '..');
	const ui = join(root, 'src/lib/ui');
	const syncPath = join(ui, 'SYNC.json');
	const violations: DriftViolation[] = files(join(root, 'src'))
		.flatMap((path) =>
			checkSvelte(relative(root, path).replace(/\\/g, '/'), readFileSync(path, 'utf8'))
		)
		.map((v) => ({ where: `${v.file}:${v.line}`, rule: v.rule }));
	violations.push(
		...checkSync(
			readStockDirs(ui),
			existsSync(syncPath) ? readFileSync(syncPath, 'utf8') : '{}',
			readFileSync(join(root, 'docs/ux-guidelines.md'), 'utf8')
		)
	);
	const exit = reportDrift('check-ui-drift', violations, strict);
	if (!violations.length) console.log('UI follows stock nova and the shared screens');
	process.exit(exit);
}
