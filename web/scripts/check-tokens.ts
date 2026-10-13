// Fails the lint on colors or text sizes that bypass the tokens in src/app.css (docs/ux-guidelines.md,
// "Tokens" and "Type scale"), and reports UI sizing drift. The prototype's fake phone chrome is exempt.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { reportDrift, strict, type DriftViolation } from './ui-drift-mode';

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

export const LARGE_TEXT_FILES = new Set([
	// Markdown headings keep their document scale.
	'src/lib/features/chat/render/markdown.svelte'
]);

export const SPIN_ALLOWED = new Set([
	// A running status glyph, not a loading indicator.
	'src/lib/features/agents/components/status-glyph.svelte'
]);

/** Stock nova keeps 16px input text below md so phones don't zoom on focus. */
const STOCK_WIDTH_SIZING = new Set(['md:text-sm']);
const WIDTH_SIZING = /(?<![\w-])(?:md|desktop-pointer):(?:h|min-h|size|text)-[\w.[\]/-]+/g;

const DRIFT_RULES: [(file: string) => boolean, (text: string) => boolean, string][] = [
	[
		(f) => !f.startsWith(UI) && !LARGE_TARGET_FILES.has(f),
		(t) => /(?<![\w-])(?:min-h|h|size)-1[2-6]\b/.test(t),
		'fixed touch size outside lib/ui; paint stock sizes and let the hit area extend'
	],
	[
		(f) => !LG_ALLOWED.has(f),
		(t) => /\bsize=["']lg["']/.test(t),
		'size="lg" outside sheet decisions and approvals'
	],
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
		(f) => f.startsWith(UI),
		(t) => [...t.matchAll(WIDTH_SIZING)].some(([m]) => !STOCK_WIDTH_SIZING.has(m)),
		'width or desktop-pointer sizing in lib/ui; size by any-pointer-coarse:'
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

if (import.meta.main) {
	const root = join(import.meta.dir, '..');
	const files = walk(join(root, 'src')).map((path) => ({
		file: relative(root, path).replace(/\\/g, '/'),
		source: readFileSync(path, 'utf8')
	}));
	const drift: DriftViolation[] = files
		.flatMap(({ file, source }) => checkDrift(file, source))
		.map((v) => ({ where: `${v.file}:${v.line}`, rule: v.rule }));
	const driftExit = reportDrift('check-tokens', drift, strict);
	const violations = files.flatMap(({ file, source }) => checkSource(file, source));
	for (const v of violations) console.error(`${v.file}:${v.line}  ${v.rule}`);
	if (violations.length) {
		console.error(`\n${violations.length} token violation(s). Use the tokens in src/app.css.`);
		process.exit(1);
	}
	console.log('colors and text sizes use tokens');
	process.exit(driftExit);
}
