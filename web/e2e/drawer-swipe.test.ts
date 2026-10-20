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

for (const pane of ['navigation', 'inspector'] as const) {
	test(`${pane} closes with a short paused swipe over controls or the chat peek`, async ({
		page,
		context
	}) => {
		await fixtureApp(context);
		await page.goto('/chat');
		const composer = page.getByRole('textbox', { name: 'Message', exact: true });
		await composer.fill('Keep my draft after dismissing a pane');
		const region =
			pane === 'navigation'
				? page.getByRole('dialog', { name: 'Menu', exact: true })
				: page.getByRole('complementary', { name: 'Conversation tasks', exact: true });
		const trigger =
			pane === 'navigation'
				? page.getByRole('button', { name: /^Menu/ })
				: page.getByRole('button', { name: 'Tasks, 3 open', exact: true });
		const control =
			pane === 'navigation'
				? region.getByRole('link', { name: 'Main', exact: true })
				: region.getByRole('button', { name: /Fix login redirect/ });
		for (const surface of pane === 'navigation'
			? ['control', 'icon', 'peek']
			: ['control', 'peek']) {
			await trigger.click();
			await expect(region).toBeVisible();
			await expect
				.poll(() =>
					page
						.locator('[data-chat-surface]')
						.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41)
				)
				.toBeCloseTo(pane === 'navigation' ? 320 : -360, 0);
			const box = await (
				surface === 'icon'
					? control.locator('svg').first()
					: surface === 'control'
						? control
						: page.getByRole('button', { name: 'Return to conversation', exact: true })
			).boundingBox();
			const visibleLeft = Math.max(0, box!.x);
			const visibleRight = Math.min(412, box!.x + box!.width);
			const x = (visibleLeft + visibleRight) / 2;
			const y = box!.y + box!.height / 2;
			await swipe(page, [x, y], [x + (pane === 'navigation' ? -72 : 72), y], true);
			await expect(region).toBeHidden();
			await expect(composer).toHaveValue('Keep my draft after dismissing a pane');
			await expect(page).toHaveURL(/\/chat$/);
		}
	});
}

test('dragging a channel link does not activate it, and a later tap still navigates', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await page.goto('/chat');
	await page.getByRole('button', { name: /^Menu/ }).click();
	const menu = page.getByRole('dialog', { name: 'Menu', exact: true });
	const channel = menu.getByRole('link', { name: 'Lease renewal', exact: true });
	const box = await channel.boundingBox();
	const x = box!.x + box!.width / 2,
		y = box!.y + box!.height / 2;
	await swipe(page, [x, y], [x - 20, y], true);
	await expect(menu).toBeVisible();
	await expect(page).toHaveURL(/\/chat$/);
	await channel.click();
	await expect(page).toHaveURL(/\/chats\/lease$/);
	await expect(page.getByRole('heading', { name: 'Lease renewal', exact: true })).toBeVisible();
});

test('the inspector retains native vertical scrolling while horizontal swipes dismiss it', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await page.setViewportSize({ width: 412, height: 400 });
	await page.goto('/chat');
	await page.getByRole('button', { name: 'Tasks, 3 open', exact: true }).click();
	const inspector = page.getByRole('complementary', { name: 'Conversation tasks', exact: true });
	const scroller = inspector.locator('.overflow-y-auto').first();
	await expect
		.poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight))
		.toBeGreaterThan(0);
	const row = inspector.getByRole('button', { name: /Fix login redirect/ });
	const box = await row.boundingBox();
	await swipe(
		page,
		[box!.x + box!.width / 2, box!.y + box!.height / 2],
		[box!.x + box!.width / 2, 90]
	);
	await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	await expect(inspector).toBeVisible();
	await expect(inspector.getByRole('tab', { name: 'Tasks', exact: true })).toBeVisible();
});

for (const interruption of ['cancel', 'blur', 'resize'] as const) {
	test(`a held drag recovers after ${interruption} and the next swipe still works`, async ({
		page,
		context
	}) => {
		await fixtureApp(context);
		await page.goto('/chat');
		const start = await chatSurface(page);
		const surface = page.locator('[data-chat-surface]');
		const offset = () =>
			surface.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
		const session = await context.newCDPSession(page);
		await session.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [start]
		});
		await session.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ x: start.x + 100, y: start.y }]
		});
		await expect.poll(offset).toBeCloseTo(100, 0);
		if (interruption === 'blur') await page.evaluate(() => dispatchEvent(new Event('blur')));
		if (interruption === 'resize') await page.setViewportSize({ width: 390, height: 844 });
		if (interruption !== 'cancel') await expect.poll(offset).toBeCloseTo(0, 0);
		await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
		await session.detach();
		await expect.poll(offset).toBeCloseTo(0, 0);
		await expect(page.locator('.workspace')).not.toHaveClass(/dragging/);
		await expect(page.getByRole('dialog', { name: 'Menu', exact: true })).toBeHidden();
		const next = await chatSurface(page);
		await swipe(page, [next.x, next.y], [next.x + 220, next.y]);
		await expect(page.getByRole('dialog', { name: 'Menu', exact: true })).toBeVisible();
		await expect.poll(offset).toBeCloseTo(320, 0);
	});
}

test('on Home a drag that starts on a row reveals channels, and a tap still opens the row', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await page.goto('/assistant');
	const row = page.locator('[data-assistant-home] a[href]').first();
	await expect(row).toBeVisible();
	const box = (await row.boundingBox())!;
	const y = box.y + box.height / 2;
	const menu = page.getByRole('dialog', { name: 'Menu', exact: true });
	await swipe(page, [box.x + 60, y], [box.x + 300, y]);
	await expect(menu).toBeVisible();
	await expect(page).toHaveURL(/\/assistant$/);
	await page.getByRole('button', { name: 'Return to conversation', exact: true }).click();
	await expect(menu).toBeHidden();
	const href = await row.getAttribute('href');
	await row.tap();
	await expect(page).toHaveURL(new RegExp(`${href!.replace(/[?]/g, '\\?')}$`));
});
