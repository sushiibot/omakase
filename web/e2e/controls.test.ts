import { expect, test } from '@playwright/test';

const harness = `http://localhost:${process.env.PW_HARNESS_PORT ?? 4174}/?controls`;

for (const touch of [true, false]) {
	test(`shared buttons preserve targets and face geometry with touch=${touch}`, async ({
		browser
	}) => {
		const context = await browser.newContext({
			viewport: { width: 1200, height: 900 },
			hasTouch: touch
		});
		const page = await context.newPage();
		try {
			await page.goto(harness);
			const action = page.getByRole('button', { name: 'Default action', exact: true });
			const icon = page.getByRole('button', { name: 'Icon action', exact: true });
			for (const control of [action, icon]) {
				await expect(control).toHaveCSS('height', touch ? '48px' : '32px');
				await expect(control.locator('[data-slot="button-face"]')).toHaveCSS(
					'height',
					touch ? '36px' : '32px'
				);
				await control.click({ position: { x: 2, y: 2 } });
			}
			await expect(page.getByRole('status')).toHaveText('Activated 2 times');
			await expect(page.getByRole('button', { name: 'Field icon action' })).toHaveCSS(
				'height',
				'48px'
			);
			const prominent = page.getByRole('button', { name: 'Prominent action' });
			await expect(prominent).toHaveCSS('height', '48px');
			await expect(prominent.locator('[data-slot="button-face"]')).toHaveCSS('height', '48px');
			const round = page.getByRole('button', { name: 'Round action' });
			expect(
				await round
					.locator('[data-slot="button-face"]')
					.evaluate((el) => getComputedStyle(el).borderRadius)
			).toBe(await round.evaluate((el) => getComputedStyle(el).borderRadius));
			await expect(page.getByRole('button', { name: 'Disabled action' })).toBeDisabled();
			const disabledLink = page.getByRole('link', { name: 'Disabled link' });
			await expect(disabledLink).toHaveAttribute('aria-disabled', 'true');
			await expect(disabledLink).not.toHaveAttribute('href');
			await page.getByRole('link', { name: 'Enabled link' }).focus();
			await page.keyboard.press('Tab');
			await expect(round).toBeFocused();
		} finally {
			await context.close();
		}
	});
}
