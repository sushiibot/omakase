// Fails the lint on colors or text sizes that bypass the tokens in src/app.css (docs/ux-guidelines.md,
// "Tokens" and "Type scale"), and reports type and sizing drift. The prototype's fake phone chrome is exempt.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { modeFromEnv, reportDrift, type DriftMode } from './ui-drift-mode';

export interface Violation {
	file: string;
	line: number;
	rule: string;
}

const PALETTE =
	/-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\b/;

const RULES: [RegExp, string][] = [
	[PALETTE, 'palette color'],
	[/\[#[0-9a-fA-F]{3,8}\]/, 'literal color'],
	[/#[0-9a-fA-F]{6}\b/, 'literal color'],
	[/\btext-\[\d+(\.\d+)?px\]/, 'px text size']
];

export function checkSource(file: string, source: string): Violation[] {
	const out: Violation[] = [];
	source.split('\n').forEach((text, i) => {
		for (const [re, rule] of RULES) if (re.test(text)) out.push({ file, line: i + 1, rule });
	});
	return out;
}

const UI = 'src/lib/ui/';

export const LARGE_TEXT_FILES = new Set([
	// Markdown headings keep their document scale.
	'src/lib/features/chat/render/markdown.svelte'
]);

export const SPIN_ALLOWED = new Set([
	// A running status glyph, not a loading indicator.
	'src/lib/features/agents/components/status-glyph.svelte'
]);

export const LAYOUT_DIRS = new Set([
	// Page and pane layout, not controls: width breakpoints legitimately size their headers and type.
	'page',
	'screen',
	'section',
	'shell',
	'workspace'
]);

/** Stock nova keeps 16px input text below md so phones don't zoom on focus. */
const STOCK_WIDTH_SIZING = new Set(['md:text-sm']);
const WIDTH_SIZING =
	/(?<![\w-])((?:max-)?(?:sm|md|lg|xl|2xl)|desktop-pointer):(?:[\w-]+:)*(min-h|h|size|text)-([\w.[\]/%-]+)/g;
const TEXT_SIZE = /^(?:xs|sm|base|lg|[2-9]?xl|\[[^\]]+\])(?:\/[\w.]+)?$/;

/** Class tokens that size a control by viewport width or the desktop-pointer variant. */
export function widthSizing(text: string): string[] {
	return [...text.matchAll(WIDTH_SIZING)].flatMap(([token, variant, prop, value]) => {
		if (prop === 'text' && !TEXT_SIZE.test(value)) return [];
		return STOCK_WIDTH_SIZING.has(`${variant}:${prop}-${value.split('/')[0]}`) ? [] : [token];
	});
}

const isControlUi = (f: string) => {
	const dir = f.match(/^src\/lib\/ui\/([^/]+)\//)?.[1];
	return dir !== undefined && !LAYOUT_DIRS.has(dir);
};

const DRIFT_RULES: [(file: string) => boolean, (text: string) => boolean, string][] = [
	[
		(f) => !f.startsWith(UI) && !LARGE_TEXT_FILES.has(f),
		(t) => /(?<![\w-])text-(?:lg|[2-9]?xl)(?![\w-])/.test(t),
		'text-lg or larger outside lib/ui and markdown'
	],
	[
		(f) => !/^src\/lib\/ui\/(spinner|status)\//.test(f) && !SPIN_ALLOWED.has(f),
		(t) => /\banimate-spin\b/.test(t),
		'animate-spin loader; use Spinner'
	],
	[
		isControlUi,
		(t) => widthSizing(t).length > 0,
		'width or desktop-pointer sizing on a lib/ui control; size by any-pointer-coarse:'
	]
];

export function checkDrift(file: string, source: string): Violation[] {
	const rules = DRIFT_RULES.filter(([applies]) => applies(file));
	const out: Violation[] = [];
	source.split('\n').forEach((text, i) => {
		for (const [, test, rule] of rules) if (test(text)) out.push({ file, line: i + 1, rule });
	});
	return out;
}

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return name === 'proto-routes' ? [] : walk(path);
		return name.endsWith('.svelte') ? [path] : [];
	});
}

/** Checks every component under root/src and returns the exit code. */
export function run(root: string, mode: DriftMode, log = console.error, ok = console.log): number {
	const files = walk(join(root, 'src')).map((path) => ({
		file: relative(root, path).replace(/\\/g, '/'),
		source: readFileSync(path, 'utf8')
	}));
	const violations = files.flatMap(({ file, source }) => checkSource(file, source));
	for (const v of violations) log(`${v.file}:${v.line}  ${v.rule}`);
	if (violations.length) {
		log(`\n${violations.length} token violation(s). Use the tokens in src/app.css.`);
	} else {
		ok('colors and text sizes use tokens');
	}
	const drift = files
		.flatMap(({ file, source }) => checkDrift(file, source))
		.map((v) => ({ where: `${v.file}:${v.line}`, rule: v.rule }));
	const driftExit = reportDrift('check-tokens', drift, mode, log);
	return violations.length ? 1 : driftExit;
}

if (import.meta.main) process.exit(run(join(import.meta.dir, '..'), modeFromEnv()));
