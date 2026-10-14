import { expect, test } from '@playwright/test';
import { fixtureApp, horizontalOverflow } from './helpers';
import { expectHitArea, outsideFace } from './hit-probe';

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

for (const desktop of [false, true]) {
	test(`channel options and archived disclosure stay independent of search on ${desktop ? 'desktop' : 'mobile'}`, async ({
		page,
		context
	}) => {
		await fixtureApp(context);
		if (desktop) await page.setViewportSize({ width: 1440, height: 1000 });
		await page.goto('/chat');
		if (!desktop) await page.getByRole('button', { name: /^Menu/ }).click();
		const nav = desktop
			? page.locator('[data-channel-navigation]')
			: page.getByRole('dialog', { name: 'Menu' });
		await expect(nav).toBeVisible();
		const archived = nav.getByRole('button', { name: /^Archived/ });
		await expect(archived).toBeVisible();
		await expect(archived).toHaveAttribute('aria-expanded', 'false');
		await expect(nav.getByRole('link', { name: /Couch delivery/ })).toBeHidden();
		await archived.click();
		await expect(nav.getByRole('link', { name: /Couch delivery/ })).toBeVisible();
		await archived.click();

		await nav.getByRole('button', { name: 'Options for Main', exact: true }).click();
		const options = page.getByRole('dialog', { name: 'Conversation settings' });
		await expect(options.getByRole('textbox')).toHaveCount(0);
		await expect(options.getByRole('link', { name: 'Open conversation' })).toHaveAttribute(
			'href',
			'/chat'
		);
		await expect(options.getByRole('button', { name: 'Archive conversation' })).toHaveCount(0);
		await options.getByRole('button', { name: 'Rename conversation' }).click();
		await expect(options.getByRole('textbox', { name: 'Conversation name' })).toBeFocused();
		await page.goBack();
		await expect(options).toBeHidden();
		if (!desktop) await page.getByRole('button', { name: /^Menu/ }).click();

		await nav.getByRole('button', { name: 'Find and filter channels' }).click();
		await expect(nav.getByRole('checkbox', { name: /archived/i })).toHaveCount(0);
		await nav.getByRole('searchbox', { name: 'Find channels by name or preview' }).fill('Couch');
		const clear = nav.getByRole('button', { name: 'Clear search', exact: true });
		await expectHitArea(page, clear, { freeSides: [] });
		// Its touch reach ends at the field's edge, short of the view filter 8px below.
		expect(await outsideFace(clear, 'bottom', 3)).toBe(true);
		expect(await outsideFace(clear, 'bottom', 6)).toBe(false);
		await expect(archived).toHaveAttribute('aria-expanded', 'true');
		await expect(nav.getByRole('link', { name: /Couch delivery/ })).toBeVisible();
		await archived.click();
		await expect(archived).toHaveAttribute('aria-expanded', 'false');
		await expect(nav.getByRole('link', { name: /Couch delivery/ })).toBeHidden();
	});
}

test('opening a sidebar conversation removes the options history entry', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto('/chat');
	await page
		.locator('[data-channel-navigation]')
		.getByRole('button', { name: 'Options for October trip' })
		.click();
	const options = page.getByRole('dialog', { name: 'Conversation settings' });
	await options.getByRole('link', { name: 'Open conversation' }).click();
	await expect(page).toHaveURL(/\/chats\/oct-trip$/);
	await page.goBack();
	await expect(page).toHaveURL(/\/chat$/);
	await expect(options).toBeHidden();
});
