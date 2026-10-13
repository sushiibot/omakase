/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkDrift, checkSource, run, widthSizing } from './check-tokens';

const rules = (source: string) => checkSource('a.svelte', source).map((v) => v.rule);

describe('check-tokens', () => {
	test('flags palette and literal colors', () => {
		expect(rules('<p class="text-red-500">x</p>')).toEqual(['palette color']);
		expect(rules('<p class="bg-[#fff]">x</p>')).toEqual(['literal color']);
		expect(rules('<p style="color: #a1b2c3">x</p>')).toEqual(['literal color']);
	});

	test('flags pixel text sizes but not tokens or rem', () => {
		expect(rules('<p class="text-[15px]">x</p>')).toEqual(['px text size']);
		expect(rules('<p class="text-[10.5px]">x</p>')).toEqual(['px text size']);
		expect(rules('<p class="text-body text-[0.8rem] text-sm">x</p>')).toEqual([]);
	});
});

describe('UI drift rules', () => {
	const FEATURE = 'src/lib/features/runs/run-list-screen.svelte';
	const drift = (file: string, source: string) => checkDrift(file, source).map((v) => v.rule);
	const one = (file: string, source: string) => {
		const found = drift(file, source);
		expect(found).toHaveLength(1);
		return found[0];
	};

	test('drift rules never fail the token check', () => {
		expect(rules('<div class="text-lg animate-spin md:h-9"></div>')).toEqual([]);
	});

	test('large text is flagged outside lib/ui and markdown', () => {
		expect(one(FEATURE, '<h2 class="text-lg font-semibold">x</h2>')).toContain('text-lg');
		expect(one(FEATURE, '<p class="md:text-2xl">x</p>')).toContain('text-lg');
		expect(drift(FEATURE, '<p class="text-sm text-base text-lg-foo">x</p>')).toEqual([]);
		expect(drift('src/lib/features/chat/render/markdown.svelte', '<h1 class="text-xl">')).toEqual(
			[]
		);
	});

	test('hand-spun loaders are flagged; Spinner and status glyphs are not', () => {
		expect(one(FEATURE, '<LoaderCircle class="size-4 animate-spin" />')).toContain('Spinner');
		expect(drift('src/lib/ui/spinner/spinner.svelte', "class={cn('animate-spin')}")).toEqual([]);
		expect(drift('src/lib/ui/status/state-pill.svelte', "'animate-spin'")).toEqual([]);
		expect(drift(FEATURE, '<Spinner />')).toEqual([]);
	});

	test('lib/ui controls size by input, not width, except stock 16px input text', () => {
		const ui = 'src/lib/ui/button/button.svelte';
		expect(one(ui, "'h-12 desktop-pointer:h-8'")).toContain('desktop-pointer');
		expect(one(ui, "'md:h-9'")).toContain('desktop-pointer');
		expect(one(ui, "'text-base md:text-base'")).toContain('desktop-pointer');
		expect(drift(ui, "'h-8 text-base md:text-sm any-pointer-coarse:after:-inset-2'")).toEqual([]);
		expect(drift(ui, "'md:flex md:gap-2'")).toEqual([]);
		expect(drift(FEATURE, '<div class="md:h-9"></div>')).toEqual([]);
	});

	test('width sizing ignores non-size text utilities and reads stacked and other breakpoints', () => {
		expect(widthSizing('md:text-muted-foreground md:text-left md:text-center')).toEqual([]);
		expect(widthSizing('md:text-sm/6')).toEqual([]);
		expect(widthSizing('md:hover:h-9 max-md:h-12 sm:size-8 lg:text-[15px] xl:min-h-10')).toEqual([
			'md:hover:h-9',
			'max-md:h-12',
			'sm:size-8',
			'lg:text-[15px]',
			'xl:min-h-10'
		]);
		expect(widthSizing('md:text-base/7')).toEqual(['md:text-base/7']);
	});

	test('layout primitives in lib/ui may size type by width', () => {
		expect(drift('src/lib/ui/screen/screen.svelte', "<h1 class='md:text-base'>")).toEqual([]);
		expect(drift('src/lib/ui/page/page-header.svelte', "<header class='md:h-14'>")).toEqual([]);
		expect(one('src/lib/ui/input/input.svelte', "'md:text-base'")).toContain('desktop-pointer');
	});
});

describe('run', () => {
	const fixture = (files: Record<string, string>) => {
		const root = mkdtempSync(join(tmpdir(), 'check-tokens-'));
		for (const [path, text] of Object.entries(files)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), text);
		}
		return root;
	};
	const quiet = () => {};
	const drifted = { 'src/lib/features/a/b.svelte': '<p class="text-lg">x</p>' };
	const broken = { 'src/lib/features/a/c.svelte': '<p class="text-red-500">x</p>' };

	test('drift alone exits 0 in warn mode and 1 in strict mode', () => {
		const root = fixture(drifted);
		try {
			expect(run(root, { strict: false, verbose: false }, quiet, quiet)).toBe(0);
			expect(run(root, { strict: true, verbose: false }, quiet, quiet)).toBe(1);
		} finally {
			rmSync(root, { recursive: true });
		}
	});

	test('a token violation still exits 1 in warn mode while drift is present', () => {
		const root = fixture({ ...drifted, ...broken });
		try {
			const lines: string[] = [];
			expect(run(root, { strict: false, verbose: false }, (l) => lines.push(l), quiet)).toBe(1);
			expect(lines.join('\n')).toContain('palette color');
		} finally {
			rmSync(root, { recursive: true });
		}
	});
});
