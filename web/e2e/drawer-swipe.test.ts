import { expect, test, type Page } from '@playwright/test';
import { fixtureApp } from './helpers';

/** Real browser touches exercise scroll arbitration, rather than only invoking event callbacks. */
async function swipe(
	page: Page,
	from: [number, number],
	to: [number, number],
	pauseBeforeEnd = false
) {
	const session = await page.context().newCDPSession(page);
	await session.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [{ x: from[0], y: from[1] }]
	});
	for (let step = 1; step <= 8; step++) {
		await session.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [
				{ x: from[0] + ((to[0] - from[0]) * step) / 8, y: from[1] + ((to[1] - from[1]) * step) / 8 }
			]
		});
	}
	if (pauseBeforeEnd) await page.waitForTimeout(100);
	await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await session.detach();
}

async function chatSurface(page: Page) {
	return page.locator('[data-chat-surface]').evaluate((chat) => {
		for (let y = 650; y >= 200; y -= 24) {
			const target = document.elementFromPoint(100, y);
			if (
				target &&
				chat.contains(target) &&
				!target.closest(
					'a,button,input,textarea,select,summary,pre,code,[contenteditable],[role="slider"],[role="tab"]'
				)
			)
				return { x: 100, y };
		}
		throw new Error('No conversation surface for pane gesture');
	});
}

test('an interior chat drag reveals channels; Back and the chat peek preserve the draft', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await page.goto('/chat');
	const composer = page.getByRole('textbox', { name: 'Message', exact: true });
	await composer.fill('Keep this draft');
	const start = await chatSurface(page);
	const menu = page.getByRole('dialog', { name: 'Menu', exact: true });
	const session = await page.context().newCDPSession(page);
	await session.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [{ x: start.x, y: start.y }]
	});
	await session.send('Input.dispatchTouchEvent', {
		type: 'touchMove',
		touchPoints: [{ x: start.x + 80, y: start.y }]
	});
	await expect
		.poll(() =>
			page
				.locator('[data-chat-surface]')
				.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41)
		)
		.toBeGreaterThan(60);
	expect(
		await page
			.locator('[data-chat-surface]')
			.evaluate((el) => getComputedStyle(el).transitionDuration)
	).toBe('0s');
	await session.send('Input.dispatchTouchEvent', {
		type: 'touchMove',
		touchPoints: [{ x: start.x + 220, y: start.y }]
	});
	await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await session.detach();
	await expect(menu).toBeVisible();
	const peek = page.getByRole('button', { name: 'Return to conversation', exact: true });
	expect((await peek.boundingBox())?.width).toBeGreaterThanOrEqual(48);
	await page.goBack();
	await expect(menu).toBeHidden();
	await expect(composer).toHaveValue('Keep this draft');
	await page.getByRole('button', { name: /^Menu/ }).click();
	await peek.click();
	await expect(menu).toBeHidden();
	await expect(composer).toHaveValue('Keep this draft');
	await page.getByRole('button', { name: /^Menu/ }).click();
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
});

test('system edges, vertical motion, slow short drags and composer touches keep their behavior', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await page.goto('/chat');
	const input = page.getByRole('textbox', { name: 'Message', exact: true });
	await expect(input).toBeVisible();
	const menu = page.getByRole('dialog', { name: 'Menu', exact: true });
	const start = await chatSurface(page);
	for (const [from, to] of [
		[
			[12, start.y],
			[240, start.y]
		],
		[
			[400, start.y],
			[120, start.y]
		],
		[
			[start.x, start.y],
			[start.x + 16, start.y - 180]
		],
		[
			[start.x, start.y],
			[start.x + 28, start.y]
		],
		[
			[start.x, start.y],
			[start.x + 120, start.y + 150]
		]
	] as [[number, number], [number, number]][]) {
		await swipe(page, from, to, true);
		await expect(menu).toBeHidden();
	}
	const box = await input.boundingBox();
	expect(box).not.toBeNull();
	await swipe(page, [box!.x + 30, box!.y + 20], [box!.x + 180, box!.y + 20]);
	await expect(menu).toBeHidden();
	await page
		.locator('main p')
		.first()
		.evaluate((el) => {
			const range = document.createRange();
			range.selectNodeContents(el);
			getSelection()?.removeAllRanges();
			getSelection()?.addRange(range);
		});
	await swipe(page, [start.x, start.y], [start.x + 220, start.y]);
	await expect(menu).toBeHidden();
	await page.evaluate(() => getSelection()?.removeAllRanges());
});

test('open sheets and desktop widths keep their gestures', async ({ page, context }) => {
	await fixtureApp(context);
	await page.goto('/chat');
	await page.getByRole('button', { name: 'Chat commands', exact: true }).click();
	const commands = page.getByRole('dialog', { name: 'Chat commands' });
	await expect(commands).toBeVisible();
	await expect(commands).toHaveAttribute('data-state', 'open');
	expect(await commands.evaluate((element) => !!element.closest('[data-shell]'))).toBe(true);
	await swipe(page, [100, 400], [320, 400]);
	await expect(page.getByRole('dialog', { name: 'Menu', exact: true })).toBeHidden();
	await page.keyboard.press('Escape');
	await page.setViewportSize({ width: 1280, height: 915 });
	await swipe(page, [100, 400], [320, 400]);
	await expect(page.getByRole('dialog', { name: 'Menu', exact: true })).toHaveCount(0);
	await expect(page.locator('[data-channel-navigation]')).toBeVisible();
});
