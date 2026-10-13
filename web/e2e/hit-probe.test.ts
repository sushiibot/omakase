import { expect, test } from '@playwright/test';
import { expectHitArea, probeHitArea } from './hit-probe';

const harness = `http://localhost:${process.env.PW_HARNESS_PORT ?? 4174}/?controls`;

for (const touch of [true, false]) {
	test(`shared buttons receive taps across their hit area with touch=${touch}`, async ({
		browser
	}) => {
		const context = await browser.newContext({
			viewport: { width: 1200, height: 900 },
			hasTouch: touch
		});
		const page = await context.newPage();
		try {
			await page.goto(harness);
			for (const name of ['Default action', 'Icon action']) {
				const control = page.getByRole('button', { name, exact: true });
				// Stacked neighbors sit above and below and the viewport edge is on the left; fine
				// pointers have no reach requirement.
				await expectHitArea(page, control, { freeSides: touch ? ['right'] : [] });
			}
		} finally {
			await context.close();
		}
	});
}

test('the hit probe reports points that miss the control', async ({ browser }) => {
	const context = await browser.newContext({
		viewport: { width: 1200, height: 900 },
		hasTouch: false
	});
	const page = await context.newPage();
	try {
		await page.goto(harness);
		const result = await probeHitArea(
			page,
			page.getByRole('button', { name: 'Icon action', exact: true })
		);
		expect(result.probed).toBe(9);
		expect(result.failures.map((f) => f.kind)).toEqual(['reach', 'reach', 'reach', 'reach']);
	} finally {
		await context.close();
	}
});
