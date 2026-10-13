/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { anchors, checkSvelte, checkSync } from './check-ui-drift';
import { reportDrift } from './ui-drift-mode';

const FEATURE = 'src/lib/features/runs/components/step-row.svelte';
const rules = (file: string, source: string) => checkSvelte(file, source).map((v) => v.rule);
const one = (file: string, source: string) => {
	const found = rules(file, source);
	expect(found).toHaveLength(1);
	return found[0];
};

describe('Button sizes', () => {
	test('flags the touch-only sizes and size-12, in literals and expressions', () => {
		expect(one(FEATURE, '<Button size="compact">x</Button>')).toContain('Button size');
		expect(one(FEATURE, '<Button size="icon-lg">x</Button>')).toContain('Button size');
		expect(one(FEATURE, `<Button size={big ? 'action' : 'sm'}>x</Button>`)).toContain(
			'Button size'
		);
		expect(one(FEATURE, '<Button class="size-12 rounded">x</Button>')).toContain('size-12');
	});

	test('allows nova sizes and leaves the Button source alone', () => {
		expect(rules(FEATURE, '<Button size="icon-sm" class="size-8">x</Button>')).toEqual([]);
		expect(rules(FEATURE, '<Button size="lg">x</Button>')).toEqual([]);
		expect(rules('src/lib/ui/button/button.svelte', '<Button size="icon-lg" />')).toEqual([]);
	});
});

describe('headings', () => {
	test('flags h1, header and h2 in features and routes', () => {
		expect(one(FEATURE, '<header>x</header>')).toContain('<h1> or <header>');
		expect(one('src/routes/chats/inbox-panel.svelte', '<h1>x</h1>')).toContain('<h1>');
		expect(one(FEATURE, '{#if a}<h2>x</h2>{/if}')).toContain('<h2>');
	});

	test('allows transcript cards, markdown, lib/ui and the shared heading components', () => {
		const card = 'src/lib/features/chat/components/approval-tray.svelte';
		expect(rules(card, '<header><h2>x</h2></header>')).toEqual([]);
		expect(rules('src/lib/features/chat/render/markdown.svelte', '<h2>x</h2>')).toEqual([]);
		expect(rules('src/lib/ui/screen/screen.svelte', '<header><h1>x</h1></header>')).toEqual([]);
		expect(rules(FEATURE, '<Section title="x" /><Sheet.Title>y</Sheet.Title>')).toEqual([]);
	});
});

describe('screens', () => {
	const screen = 'src/lib/features/runs/run-list-screen.svelte';

	test('a feature screen roots in a shared screen, through blocks and snippets', () => {
		expect(rules(screen, '<ListScreen title="x">y</ListScreen>')).toEqual([]);
		expect(rules(screen, '<Page.Root>y</Page.Root>')).toEqual([]);
		expect(
			rules(
				screen,
				'{#snippet a()}<div></div>{/snippet}\n<svelte:head><title>x</title></svelte:head>\n{#if x}<DetailScreen />{:else}<ChatScreen />{/if}'
			)
		).toEqual([]);
	});

	test('a feature screen rooted in markup or the bare Screen is flagged', () => {
		expect(rules(screen, '<DetailScreen />\n<RoutedSheet open={x}>y</RoutedSheet>')).toEqual([]);
		expect(one(screen, '<RoutedSheet open={x}>y</RoutedSheet>')).toContain('screen root');
		expect(one(screen, '<div class="flex"><ListScreen /></div>')).toContain('screen root');
		expect(one(screen, '<Screen title="x" />')).toContain('screen root');
		expect(one(screen, '{#if x}<ListScreen />{:else}<p>none</p>{/if}')).toContain('screen root');
		expect(rules('src/lib/features/runs/components/x.svelte', '<div />')).toEqual([]);
	});

	test('a route page renders components, not markup', () => {
		expect(rules('src/routes/runs/+page.svelte', '<RunListScreen {...props} />')).toEqual([]);
		expect(one('src/routes/runs/[id]/+page.svelte', '<main><RunScreen /></main>')).toContain(
			'route renders markup'
		);
		expect(rules('src/routes/runs/+layout.svelte', '<main />')).toEqual([]);
	});

	test('raw measures in features are flagged; prose and bubble widths are not', () => {
		expect(one(FEATURE, '<div class="mx-auto sm:max-w-2xl"></div>')).toContain('max-w');
		expect(rules(FEATURE, '<p class="max-w-prose max-w-[85%] max-w-full"></p>')).toEqual([]);
		expect(rules('src/lib/ui/screen/screen.svelte', '<div class="max-w-3xl"></div>')).toEqual([]);
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

	test('drift reasons must cite an anchor that exists', () => {
		expect(check({ badge }, { badge: { drift: 'looks nicer' } })).toEqual([
			'SYNC.json drift reason must be "none" or cite (ux-guidelines.md#<anchor>)'
		]);
		expect(check({ badge }, { badge: { drift: 'x (ux-guidelines.md#nope)' } })).toEqual([
			'SYNC.json drift reason cites a missing ux-guidelines.md anchor'
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

	test('warn mode prints a grouped report and exits 0', () => {
		const lines: string[] = [];
		expect(reportDrift('x', violations, false, (l) => lines.push(l))).toBe(0);
		const text = lines.join('\n');
		expect(text).toContain('rule a (2)');
		expect(text).toContain('rule b (1)');
		expect(text).toContain('3 UI drift warning(s)');
		expect(text).toContain('UI_DRIFT_STRICT=1');
	});

	test('strict mode exits 1, and a clean tree exits 0 in either mode', () => {
		expect(reportDrift('x', violations, true, () => {})).toBe(1);
		expect(reportDrift('x', [], true, () => {})).toBe(0);
		expect(reportDrift('x', [], false, () => {})).toBe(0);
	});
});
