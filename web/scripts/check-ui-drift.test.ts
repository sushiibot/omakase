/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { anchors, checkSvelte, checkSync, run } from './check-ui-drift';
import { modeFromEnv, reportDrift } from './ui-drift-mode';

const FEATURE = 'src/lib/features/runs/components/step-row.svelte';
const rules = (file: string, source: string) => checkSvelte(file, source).map((v) => v.rule);
const one = (file: string, source: string) => {
	const found = rules(file, source);
	expect(found).toHaveLength(1);
	return found[0];
};

describe('Button sizes', () => {
	test('flags the touch-only sizes and size-12, in literals, expressions and class directives', () => {
		expect(one(FEATURE, '<Button size="compact">x</Button>')).toContain('Button size compact');
		expect(one(FEATURE, '<Button size="icon-lg">x</Button>')).toContain('Button size compact');
		expect(one(FEATURE, `<Button size={big ? 'action' : 'sm'}>x</Button>`)).toContain(
			'Button size compact'
		);
		expect(one(FEATURE, '<Button class="size-12 rounded">x</Button>')).toContain('size-12');
		expect(one(FEATURE, '<Button class:size-12={big}>x</Button>')).toContain('size-12');
	});

	test('allows nova sizes; the sheet close in lib/ui is still checked, the Button source is not', () => {
		expect(rules(FEATURE, '<Button size="icon-sm" class="size-8">x</Button>')).toEqual([]);
		expect(one('src/lib/ui/sheet/sheet-content.svelte', '<Button size="icon-lg" />')).toContain(
			'Button size compact'
		);
		expect(rules('src/lib/ui/button/button.svelte', '<Button size="icon-lg" />')).toEqual([]);
	});

	test('size lg is flagged on a Button outside sheet decisions, approvals and lib/ui', () => {
		expect(one(FEATURE, '<Button size="lg">Go</Button>')).toContain('Button size lg');
		expect(one(FEATURE, `<Button size={'lg'}>Go</Button>`)).toContain('Button size lg');
		expect(one(FEATURE, `<Button size={wide ? 'lg' : 'sm'}>Go</Button>`)).toContain(
			'Button size lg'
		);
		expect(rules(FEATURE, '<Avatar size="lg" /><div data-size="lg"></div>')).toEqual([]);
		expect(
			rules('src/lib/features/threads/components/branch-sheet.svelte', '<Button size="lg" />')
		).toEqual([]);
		expect(rules('src/lib/ui/sheet/sheet-footer.svelte', '<Button size="lg" />')).toEqual([]);
	});
});

describe('touch sizes', () => {
	test('flags fixed touch sizes on interactive elements outside lib/ui', () => {
		expect(one(FEATURE, '<a href="/x" class="flex min-h-13">x</a>')).toContain('fixed touch size');
		expect(one(FEATURE, '<div role="button" class="h-12"></div>')).toContain('fixed touch size');
		expect(one(FEATURE, '<Item onclick={go} class="pointer-coarse:size-12" />')).toContain(
			'fixed touch size'
		);
		expect(one(FEATURE, '<Button class="h-12">x</Button>')).toContain('fixed touch size');
	});

	test('skips layout boxes, size-12 on a Button, lib/ui and the allowlist', () => {
		expect(rules(FEATURE, '<Skeleton class="h-12 w-full" /><pre class="min-h-12"></pre>')).toEqual(
			[]
		);
		expect(rules(FEATURE, '<a href="/x" class="h-8 max-h-12 size-10 h-120">x</a>')).toEqual([]);
		expect(rules(FEATURE, '<Button class="size-12">x</Button>')).toEqual([
			'size-12 on a Button; let the coarse-pointer hit area extend it'
		]);
		expect(rules('src/lib/ui/shell/shell.svelte', '<a href="/" class="h-12">x</a>')).toEqual([]);
		expect(
			rules(
				'src/lib/features/chat/components/composer.svelte',
				'<button class="size-12">x</button>'
			)
		).toEqual([]);
	});
});

describe('headings', () => {
	test('flags h1, header and h2 in features and routes', () => {
		expect(one(FEATURE, '<header>x</header>')).toContain('<h1> or <header>');
		expect(one('src/routes/chats/inbox-panel.svelte', '<h1>x</h1>')).toContain('<h1>');
		expect(one(FEATURE, '{#if a}<h2>x</h2>{/if}')).toContain('<h2>');
		expect(one('src/routes/+layout.svelte', '<h2>x</h2>')).toContain('in a feature or route');
	});

	test('transcript cards may use h2 but not header; markdown may use both', () => {
		const card = 'src/lib/features/chat/components/approval-tray.svelte';
		expect(rules(card, '<h2>x</h2>')).toEqual([]);
		expect(one(card, '<header><h2>x</h2></header>')).toContain('<h1> or <header>');
		const markdown = 'src/lib/features/chat/render/markdown.svelte';
		expect(rules(markdown, '<h1>x</h1><h2>y</h2>')).toEqual([]);
	});

	test('lib/ui and the shared heading components are allowed', () => {
		expect(rules('src/lib/ui/screen/screen.svelte', '<header><h1>x</h1></header>')).toEqual([]);
		expect(rules(FEATURE, '<Section title="x" /><Sheet.Title>y</Sheet.Title>')).toEqual([]);
	});
});

describe('screens', () => {
	const screen = 'src/lib/features/runs/run-list-screen.svelte';

	test('a feature screen roots in a shared screen, through blocks, snippets and boundaries', () => {
		expect(rules(screen, '<ListScreen title="x">y</ListScreen>')).toEqual([]);
		expect(rules(screen, '<Page.Root>y</Page.Root>')).toEqual([]);
		expect(
			rules(
				screen,
				'{#snippet a()}<div></div>{/snippet}\n<svelte:head><title>x</title></svelte:head>\n{#if x}<DetailScreen />{:else}<ChatScreen />{/if}'
			)
		).toEqual([]);
		expect(rules(screen, '<svelte:boundary><ListScreen /></svelte:boundary>')).toEqual([]);
	});

	test('sheets, dialogs and drawers may sit beside the root', () => {
		for (const overlay of [
			'<RoutedSheet open={x}>y</RoutedSheet>',
			'<AlertDialog.Root />',
			'<Dialog.Root />',
			'<Drawer.Root />',
			'<BranchSheet />'
		]) {
			expect(rules(screen, `<DetailScreen />\n${overlay}`), overlay).toEqual([]);
		}
		expect(one(screen, '<RoutedSheet open={x}>y</RoutedSheet>')).toContain('screen root');
	});

	test('a feature screen rooted in markup or the bare Screen is flagged', () => {
		expect(one(screen, '<div class="flex"><ListScreen /></div>')).toContain('screen root');
		expect(one(screen, '<Screen title="x" />')).toContain('screen root');
		expect(rules('src/lib/features/chat/chat-screen.svelte', '<Screen title="x" />')).toEqual([]);
		expect(
			one('src/lib/features/chat/chat-screen.svelte', '<div><Screen title="x" /></div>')
		).toContain('screen root');
		expect(one(screen, '{#if x}<ListScreen />{:else}<p>none</p>{/if}')).toContain('screen root');
		// A toast beside the screen is drift: it belongs inside the screen or in a shared toast.
		expect(one(screen, '<ListScreen />\n<div role="status">Undone</div>')).toContain('screen root');
		expect(rules('src/lib/features/runs/components/x.svelte', '<div />')).toEqual([]);
	});

	test('a route page renders a screen, an overlay or an allowlisted root', () => {
		expect(rules('src/routes/runs/+page.svelte', '<RunListScreen {...props} />')).toEqual([]);
		expect(
			rules(
				'src/routes/chat/+page.svelte',
				'<svelte:head><title>x</title></svelte:head>\n<TaskWorkspace /><ClearNotifications /><BranchSheet />'
			)
		).toEqual([]);
		expect(rules('src/routes/agents/[id]/+page.svelte', '<AgentPage id="a" />')).toEqual([]);
		expect(one('src/routes/runs/[id]/+page.svelte', '<main><RunScreen /></main>')).toContain(
			'route does not render a feature screen'
		);
		expect(one('src/routes/x/+page.svelte', '<Button>x</Button>')).toContain(
			'route does not render a feature screen'
		);
		expect(one('src/routes/tasks/+page.svelte', '{#key id}<TaskPanel />{/key}')).toContain(
			'route does not render a feature screen'
		);
		expect(rules('src/routes/runs/+layout.svelte', '<main />')).toEqual([]);
	});

	test('raw measures in feature attributes are flagged; prose, full and bubble widths are not', () => {
		expect(one(FEATURE, '<div class="mx-auto sm:max-w-2xl"></div>')).toContain('max-w');
		expect(one(FEATURE, '<div class="max-w-[40rem]"></div>')).toContain('max-w');
		expect(one(FEATURE, '<div class="max-w-2xs"></div>')).toContain('max-w');
		expect(one(FEATURE, '<Panel contentClass="max-w-64" />')).toContain('max-w');
		expect(rules(FEATURE, '<p class="max-w-prose max-w-[85%] max-w-full max-w-none"></p>')).toEqual(
			[]
		);
		expect(rules('src/lib/ui/screen/screen.svelte', '<div class="max-w-3xl"></div>')).toEqual([]);
	});

	test('comments and script strings are not markup', () => {
		expect(
			rules(
				FEATURE,
				'<script>const w = \'max-w-md h-12\';</script>\n<!-- max-w-md --><p class="text-sm"></p>'
			)
		).toEqual([]);
	});
});

describe('raw controls', () => {
	test('flags native controls in features', () => {
		for (const tag of ['<button>x</button>', '<input />', '<select></select>', '<textarea />']) {
			expect(one(FEATURE, tag)).toContain('raw <button>');
		}
	});

	test('allows the composer, lib/ui and the shared components', () => {
		expect(rules('src/lib/features/chat/components/composer.svelte', '<textarea />')).toEqual([]);
		expect(rules('src/lib/ui/input/input.svelte', '<input />')).toEqual([]);
		expect(rules(FEATURE, '<Button>x</Button><Input />')).toEqual([]);
	});
});

describe('SYNC.json and nova headers', () => {
	const guidelines =
		'# Guide\n## Reach and touch targets\n### Tabs, swipes, and scroll ownership\n';
	const badge = { 'badge.svelte': '<!-- shadcn-svelte nova: ui/badge/badge.svelte -->\n<span />' };
	const sync = (entries: object) => JSON.stringify(entries);
	const check = (
		dirs: Record<string, Record<string, string>>,
		entries: object,
		text = guidelines
	) => checkSync(dirs, sync(entries), text).map((v) => v.rule);

	test('anchors follow GitHub slugs', () => {
		expect([...anchors(guidelines)]).toEqual([
			'guide',
			'reach-and-touch-targets',
			'tabs-swipes-and-scroll-ownership'
		]);
		expect([...anchors('## A\n## A\n')]).toEqual(['a', 'a-1']);
		expect([...anchors('## [Link](http://x.y) text\n')]).toEqual(['link-text']);
	});

	test('headings inside fenced code are not anchors', () => {
		expect([...anchors('## Real\n```md\n## Fake\n```\n~~~\n# Also fake\n~~~\n')]).toEqual(['real']);
	});

	test('a headed stock dir with a none or anchored entry passes', () => {
		expect(check({ badge }, { badge: { drift: 'none' } })).toEqual([]);
		expect(
			check(
				{
					button: {
						'button.svelte': '<!-- shadcn-svelte nova: ui/button/button.svelte @ abc123 -->',
						'index.ts': '// shadcn-svelte nova: ui/button/index.ts\nexport {};'
					}
				},
				{ button: { drift: 'hit area (ux-guidelines.md#reach-and-touch-targets)' } }
			)
		).toEqual([]);
	});

	test('missing and orphan entries are flagged', () => {
		expect(check({ badge }, {})).toEqual(['stock-named lib/ui dir without a SYNC.json entry']);
		expect(check({}, { badge: { drift: 'none' } })).toEqual([
			'SYNC.json entry without a stock-named lib/ui dir'
		]);
	});

	test('drift reasons must cite anchors that exist, every one of them', () => {
		expect(check({ badge }, { badge: { drift: 'looks nicer' } })).toEqual([
			'SYNC.json drift reason must be "none" or cite (ux-guidelines.md#<anchor>)'
		]);
		expect(check({ badge }, { badge: { drift: 'x (ux-guidelines.md#nope)' } })).toEqual([
			'SYNC.json drift reason cites a missing ux-guidelines.md anchor'
		]);
		expect(
			check(
				{ badge },
				{
					badge: {
						drift: 'a (ux-guidelines.md#reach-and-touch-targets) b (ux-guidelines.md#nope)'
					}
				}
			)
		).toEqual(['SYNC.json drift reason cites a missing ux-guidelines.md anchor']);
	});

	test('a SYNC.json that is not an object of entries is reported, not thrown', () => {
		const shape = 'SYNC.json must be an object of { "<component>": { "drift": ... } }';
		for (const json of ['null', '[]', '"x"', '{ not json']) {
			expect(
				checkSync({ badge }, json, guidelines).map((v) => v.rule),
				json
			).toEqual([shape]);
		}
		expect(check({ badge }, { badge: null })).toEqual([
			'SYNC.json drift reason must be "none" or cite (ux-guidelines.md#<anchor>)'
		]);
	});

	test('every stock file carries its own nova header; local parts are exempt', () => {
		const header = 'stock-named lib/ui file without its shadcn-svelte nova header';
		expect(check({ badge: { 'badge.svelte': '<span />' } }, { badge: { drift: 'none' } })).toEqual([
			header
		]);
		expect(
			check(
				{ badge: { 'badge.svelte': '<!-- shadcn-svelte nova: ui/badge/other.svelte -->' } },
				{ badge: { drift: 'none' } }
			)
		).toEqual([header]);
		expect(
			check(
				{ tabs: { 'swipeable-tabs.svelte': '<div />' } },
				{ tabs: { drift: 'pager (ux-guidelines.md#tabs-swipes-and-scroll-ownership)' } }
			)
		).toEqual([]);
	});
});

describe('warn and strict modes', () => {
	const violations = [
		{ where: 'a.svelte:1', rule: 'rule a' },
		{ where: 'b.svelte:2', rule: 'rule a' },
		{ where: 'c.svelte:3', rule: 'rule b' }
	];
	const warn = { strict: false, verbose: false };
	const strict = { strict: true, verbose: false };

	test('the mode comes from UI_DRIFT_STRICT and UI_DRIFT_VERBOSE', () => {
		expect(modeFromEnv({})).toEqual(warn);
		expect(modeFromEnv({ UI_DRIFT_STRICT: '1', UI_DRIFT_VERBOSE: '1' })).toEqual({
			strict: true,
			verbose: true
		});
		expect(modeFromEnv({ UI_DRIFT_STRICT: 'true' })).toEqual(warn);
	});

	test('warn mode prints only per-rule counts and exits 0', () => {
		const lines: string[] = [];
		expect(reportDrift('x', violations, warn, (l) => lines.push(l))).toBe(0);
		const text = lines.join('\n');
		expect(text).toContain('3 UI drift warning(s)');
		expect(text).toMatch(/2 {2}rule a/);
		expect(text).not.toContain('a.svelte:1');
		expect(text).toContain('UI_DRIFT_STRICT=1');
	});

	test('verbose and strict modes list each violation under its rule', () => {
		for (const mode of [{ strict: false, verbose: true }, strict]) {
			const lines: string[] = [];
			reportDrift('x', violations, mode, (l) => lines.push(l));
			const text = lines.join('\n');
			expect(text).toContain('rule a (2)');
			expect(text).toContain('  c.svelte:3');
		}
	});

	test('strict mode exits 1 and says why; a clean tree exits 0 in either mode', () => {
		const lines: string[] = [];
		expect(reportDrift('x', violations, strict, (l) => lines.push(l))).toBe(1);
		expect(lines.at(-1)).toContain('UI_DRIFT_STRICT=1');
		expect(reportDrift('x', [], strict, () => {})).toBe(0);
		expect(reportDrift('x', [], warn, () => {})).toBe(0);
	});
});

describe('run', () => {
	const fixture = (files: Record<string, string>) => {
		const root = mkdtempSync(join(tmpdir(), 'check-ui-drift-'));
		for (const [path, text] of Object.entries(files)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), text);
		}
		return root;
	};
	const quiet = () => {};
	const base = {
		'docs/ux-guidelines.md': '# Guide\n',
		'src/lib/ui/SYNC.json': '{ "badge": { "drift": "none" } }',
		'src/lib/ui/badge/badge.svelte': '<!-- shadcn-svelte nova: ui/badge/badge.svelte -->\n<span />'
	};

	test('a clean tree exits 0 in strict mode', () => {
		const root = fixture(base);
		try {
			expect(run(root, { strict: true, verbose: false }, quiet, quiet)).toBe(0);
		} finally {
			rmSync(root, { recursive: true });
		}
	});

	test('drift exits 0 in warn mode and 1 in strict mode', () => {
		const root = fixture({ ...base, 'src/lib/features/a/b.svelte': '<h2>x</h2>' });
		try {
			expect(run(root, { strict: false, verbose: false }, quiet, quiet)).toBe(0);
			expect(run(root, { strict: true, verbose: false }, quiet, quiet)).toBe(1);
		} finally {
			rmSync(root, { recursive: true });
		}
	});

	test('the script reads UI_DRIFT_STRICT from the environment', () => {
		const script = join(import.meta.dir, 'check-ui-drift.ts');
		const exit = (env: Record<string, string>) =>
			Bun.spawnSync(['bun', script], { env: { ...process.env, ...env } }).exitCode;
		expect(exit({ UI_DRIFT_STRICT: '0' })).toBe(0);
		expect(exit({ UI_DRIFT_STRICT: '1' })).toBe(1);
	});
});
