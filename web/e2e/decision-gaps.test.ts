import { expect, test, type Locator, type Page } from '@playwright/test';
import { fixtureApp } from './helpers';

const harness = `http://localhost:${process.env.PW_HARNESS_PORT ?? 4174}/?surfaces`;

type Owner = 'first' | 'second' | 'other';

/** Who receives taps 1–7px into the gap between two neighbouring controls, from each side. */
async function gapOwners(first: Locator, second: Locator) {
	const a = await first.elementHandle();
	const b = await second.elementHandle();
	await first.scrollIntoViewIfNeeded();
	return first.page().evaluate(
		([a, b]) => {
			const ra = a!.getBoundingClientRect();
			const rb = b!.getBoundingClientRect();
			const across = rb.left >= ra.right;
			const owner = (x: number, y: number): Owner => {
				const hit = document.elementFromPoint(x, y);
				return hit && a!.contains(hit) ? 'first' : hit && b!.contains(hit) ? 'second' : 'other';
			};
			const fromFirst: Owner[] = [];
			const fromSecond: Owner[] = [];
			for (let d = 1; d <= 7; d++) {
				if (across) {
					const y = (Math.max(ra.top, rb.top) + Math.min(ra.bottom, rb.bottom)) / 2;
					fromFirst.push(owner(ra.right + d, y));
					fromSecond.push(owner(rb.left - d, y));
				} else {
					const x = (Math.max(ra.left, rb.left) + Math.min(ra.right, rb.right)) / 2;
					fromFirst.push(owner(x, ra.bottom + d));
					fromSecond.push(owner(x, rb.top - d));
				}
			}
			return { fromFirst, fromSecond };
		},
		[a, b] as const
	);
}

/** Taps next to one control never land on the other, whichever side they start from. */
async function expectNearerOrNothing(first: Locator, second: Locator) {
	const { fromFirst, fromSecond } = await gapOwners(first, second);
	expect(fromFirst, 'taps past the first control').not.toContain('second');
	expect(fromSecond, 'taps past the second control').not.toContain('first');
}

async function surfaces(page: Page) {
	await page.goto(harness);
	expect(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(true);
}

test('inline chat approval keeps Deny, Approve and Exact input apart on touch', async ({
	page
}) => {
	await surfaces(page);
	const inline = page.locator('[data-surface-probe="inline"]');
	const deny = inline.getByRole('button', { name: /^Deny/ });
	const approve = inline.getByRole('button', { name: /^Approve/ });
	await expectNearerOrNothing(deny, approve);
	// Nothing in the decision row reaches into the disclosure above it.
	const exact = inline.locator('summary');
	await exact.scrollIntoViewIfNeeded();
	const inside = await exact.evaluate((el) => {
		const r = el.getBoundingClientRect();
		return [1, 4, 7].map((d) => {
			const hit = document.elementFromPoint(r.left + 40, r.bottom - d);
			return !!hit && el.contains(hit);
		});
	});
	expect(inside).toEqual([true, true, true]);
	const right = (await deny.boundingBox())!;
	await page.touchscreen.tap(right.x + right.width + 6, right.y + right.height / 2);
	await expect(page.locator('[data-fired]')).not.toContainText('inline:approve');
});

test('agent approval card keeps Deny and Approve apart on touch', async ({ page }) => {
	await surfaces(page);
	const card = page.locator('[data-surface-probe="card"]');
	await expectNearerOrNothing(
		card.locator('[data-decision="decline"]'),
		card.locator('[data-decision="accept"]')
	);
});

test('tool confirmation keeps its choices apart in either order', async ({ page }) => {
	await surfaces(page);
	for (const probe of ['confirm-no-yes', 'confirm-yes-no']) {
		const buttons = page.locator(`[data-surface-probe="${probe}"] [data-slot="button"]`);
		await expect(buttons).toHaveCount(2);
		await expectNearerOrNothing(buttons.nth(0), buttons.nth(1));
	}
});

test('the voice bar keeps End call apart from its neighbours', async ({ page }) => {
	await surfaces(page);
	const voice = page.locator('[data-surface-probe="voice"]');
	const mute = voice.getByRole('button', { name: 'Mute microphone' });
	const interrupt = voice.getByRole('button', { name: 'Stop speaking' });
	const end = voice.getByRole('button', { name: 'End call' });
	await expectNearerOrNothing(mute, interrupt);
	await expectNearerOrNothing(interrupt, end);
});

test('the task action stack keeps Stop and Mark done apart on touch', async ({ page, context }) => {
	await fixtureApp(context);
	await page.goto('/tasks/t-notes');
	const ask = page.getByRole('button', { name: /Ask Sushii|Continue with Sushii/ });
	const stop = page.getByRole('button', { name: 'Stop active work' });
	const done = page.getByRole('button', { name: 'Mark done' });
	await expect(stop).toBeVisible();
	await expectNearerOrNothing(ask, stop);
	await expectNearerOrNothing(stop, done);
});
