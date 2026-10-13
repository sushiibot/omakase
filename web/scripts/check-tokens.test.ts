/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { checkDrift, checkSource } from './check-tokens';

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
		expect(rules('<div class="h-12 text-lg animate-spin"></div>')).toEqual([]);
	});

	test('fixed touch sizes are flagged outside lib/ui and the allowlist', () => {
		expect(one(FEATURE, '<div class="flex min-h-13"></div>')).toContain('fixed touch size');
		expect(one(FEATURE, '<i class="pointer-coarse:size-12"></i>')).toContain('fixed touch size');
		expect(drift(FEATURE, '<div class="h-8 max-h-12 size-10 h-120"></div>')).toEqual([]);
		expect(drift('src/lib/ui/shell/shell.svelte', '<div class="h-12"></div>')).toEqual([]);
		expect(
			drift('src/lib/features/chat/components/composer.svelte', '<div class="size-12"></div>')
		).toEqual([]);
	});

	test('size="lg" is flagged outside sheet decisions and approvals', () => {
		expect(one(FEATURE, '<Button size="lg">Go</Button>')).toContain('size="lg"');
		expect(
			drift('src/lib/features/threads/components/branch-sheet.svelte', '<Button size="lg" />')
		).toEqual([]);
		expect(drift(FEATURE, '<Button size="sm">Go</Button>')).toEqual([]);
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

	test('lib/ui sizes controls by input, not width, except stock 16px input text', () => {
		const ui = 'src/lib/ui/button/button.svelte';
		expect(one(ui, "'h-12 desktop-pointer:h-8'")).toContain('desktop-pointer');
		expect(one(ui, "'md:h-9'")).toContain('desktop-pointer');
		expect(one(ui, "'text-base md:text-base'")).toContain('desktop-pointer');
		expect(drift(ui, "'h-8 text-base md:text-sm any-pointer-coarse:after:-inset-2'")).toEqual([]);
		expect(drift(ui, "'md:flex md:gap-2'")).toEqual([]);
		expect(drift(FEATURE, '<div class="md:h-9"></div>')).toEqual([]);
	});
});
