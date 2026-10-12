import { expect, test } from '@playwright/test';
import { fixtureApp, horizontalOverflow } from './helpers';

test('channels reveal under chat and Back preserves the draft', async ({ page, context }) => {
	await fixtureApp(context);
	await page.goto('/chat');
	const composer = page.getByRole('textbox', { name: 'Message', exact: true });
	await composer.fill('Keep this draft while browsing channels');
	const main = await page.locator('main').boundingBox();
	const session = await context.newCDPSession(page);
	const y = main!.y + 70;
	await session.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [{ x: 100, y }]
	});
	await session.send('Input.dispatchTouchEvent', {
		type: 'touchMove',
		touchPoints: [{ x: 160, y }]
	});
	await session.send('Input.dispatchTouchEvent', {
		type: 'touchMove',
		touchPoints: [{ x: 280, y }]
	});
	await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await session.detach();
	const menu = page.getByRole('dialog', { name: 'Menu' });
	await expect(menu).toBeVisible();
	await expect
		.poll(() =>
			page
				.locator('[data-chat-surface]')
				.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41)
		)
		.toBeCloseTo(320, 0);
	await expect(menu.getByRole('link', { name: 'Main', exact: true })).toBeVisible();
	await expect(page.locator('[data-chat-surface] > .chat-content')).toHaveAttribute(
		'aria-hidden',
		'true'
	);
	await page.goBack();
	await expect(composer).toBeVisible();
	await expect(composer).toHaveValue('Keep this draft while browsing channels');
	await expect
		.poll(() =>
			page
				.locator('[data-chat-surface]')
				.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41)
		)
		.toBeCloseTo(0, 0);
	expect(await horizontalOverflow(page)).toEqual([]);
});

test('desktop navigation persists across Workspace destinations', async ({ page, context }) => {
	await fixtureApp(context);
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto('/chat');
	const nav = page.locator('[data-channel-navigation]');
	await expect(nav).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Main', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await nav.getByRole('link', { name: 'Workspace', exact: true }).click();
	await expect(
		page.getByRole('heading', { name: 'Workspace', exact: true, level: 1 })
	).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Main', exact: true })).toBeVisible();
	await nav.getByRole('link', { name: 'Main', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
});

test('workspace visual review covers both pane layouts and themes', async ({
	page,
	context
}, info) => {
	await fixtureApp(context);
	for (const dark of [false, true]) {
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.goto('/chat');
		await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
		await page.getByRole('button', { name: 'Tasks, 3 open' }).click();
		await page
			.getByRole('complementary', { name: 'Conversation tasks' })
			.getByRole('button', { name: /Fix login redirect/ })
			.click();
		await page.screenshot({ path: info.outputPath(`desktop-${dark ? 'dark' : 'light'}.png`) });
		await page.setViewportSize({ width: 412, height: 915 });
		await page.goto('/chat');
		await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
		await page.getByRole('button', { name: /^Menu/ }).click();
		await expect
			.poll(() =>
				page
					.locator('[data-chat-surface]')
					.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41)
			)
			.toBeCloseTo(320, 0);
		await page.screenshot({ path: info.outputPath(`mobile-${dark ? 'dark' : 'light'}.png`) });
		await page.goBack();
		await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden();
	}
});
