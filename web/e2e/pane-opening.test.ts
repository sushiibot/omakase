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
			const target = document.elementFromPoint(200, y);
			if (
				target &&
				chat.contains(target) &&
				!target.closest(
					'a,button,input,textarea,select,summary,pre,code,[contenteditable],[role="slider"],[role="tab"]'
				)
			)
				return { x: 200, y };
		}
		throw new Error('No conversation surface for pane gesture');
	});
}

for (const pane of ['navigation', 'inspector'] as const) {
	test(`${pane} stays open after a short paused drag`, async ({ page, context }) => {
		await fixtureApp(context);
		await page.goto('/chat');
		await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
		const start = await chatSurface(page);
		await swipe(page, [200, start.y], [200 + (pane === 'navigation' ? 72 : -72), start.y], true);
		await expect(
			pane === 'navigation'
				? page.getByRole('dialog', { name: 'Menu', exact: true })
				: page.getByRole('complementary', { name: 'Conversation tasks', exact: true })
		).toBeVisible();
		await expect
			.poll(() =>
				page
					.locator('[data-chat-surface]')
					.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41)
			)
			.toBeCloseTo(pane === 'navigation' ? 320 : -360, 0);
	});
}
