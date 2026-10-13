import { expect, test, type Page } from '@playwright/test';
import { expectHitArea } from './hit-probe';

const harness = `http://localhost:${process.env.PW_HARNESS_PORT ?? 4174}/?controls`;

const FACES: [name: string, size: number][] = [
	['Default action', 32],
	['Icon action', 32],
	['Small action', 28],
	['Small icon action', 28],
	['Prominent action', 36],
	['Prominent icon action', 36]
];

const coarse = (page: Page) => page.evaluate(() => matchMedia('(any-pointer: coarse)').matches);

test('shared buttons extend their hit area on a coarse pointer', async ({ browser }) => {
	const context = await browser.newContext({
		viewport: { width: 412, height: 915 },
		hasTouch: true,
		isMobile: true
	});
	const page = await context.newPage();
	try {
		await page.goto(harness);
		expect(await coarse(page)).toBe(true);
		for (const [name, size] of FACES) {
			const control = page.getByRole('button', { name, exact: true });
			await expect(control).toHaveCSS('height', `${size}px`);
			// The hit area grows at most 8px sideways, so faces under 32px wide reach 48px only vertically.
			const narrow = name.includes('icon') && size < 32;
			await expectHitArea(page, control, narrow ? { freeSides: ['top', 'bottom'] } : {});
		}
		const action = page.getByRole('button', { name: 'Default action', exact: true });
		await action.scrollIntoViewIfNeeded();
		const box = (await action.boundingBox())!;
		await page.touchscreen.tap(box.x + box.width / 2, box.y - 6);
		await expect(page.getByRole('status')).toHaveText('Activated 1 times');
	} finally {
		await context.close();
	}
});

test('shared buttons paint nova sizes on a fine pointer', async ({ browser }) => {
	const context = await browser.newContext({
		viewport: { width: 1200, height: 900 },
		hasTouch: false,
		isMobile: false
	});
	const page = await context.newPage();
	try {
		await page.goto(harness);
		expect(await coarse(page)).toBe(false);
		for (const [name, size] of FACES) {
			const control = page.getByRole('button', { name, exact: true });
			await expect(control).toHaveCSS('height', `${size}px`);
			await expectHitArea(page, control, { freeSides: [] });
		}
		const icon = page.getByRole('button', { name: 'Icon action', exact: true });
		await expect(icon).toHaveCSS('width', '32px');
		await icon.click({ position: { x: 1, y: 1 } });
		await page.getByRole('button', { name: 'Default action', exact: true }).click();
		await expect(page.getByRole('status')).toHaveText('Activated 2 times');
		await expect(page.getByRole('button', { name: 'Disabled action' })).toBeDisabled();
		const disabledLink = page.getByRole('link', { name: 'Disabled link' });
		await expect(disabledLink).toHaveAttribute('aria-disabled', 'true');
		await expect(disabledLink).not.toHaveAttribute('href');
		await page.getByRole('link', { name: 'Enabled link' }).focus();
		await page.keyboard.press('Tab');
		await expect(page.getByRole('button', { name: 'Next action' })).toBeFocused();
	} finally {
		await context.close();
	}
});
