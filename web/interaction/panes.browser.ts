import { expect, test, type Page, type CDPSession } from '@playwright/test';

async function begin(page: Page, x: number, y: number) {
	const session = await page.context().newCDPSession(page);
	await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
	return session;
}

async function move(session: CDPSession, x: number, y: number) {
	await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
}

async function end(session: CDPSession) {
	await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await session.detach();
}

function surface(page: Page) {
	return page.locator('[data-chat-surface]');
}

async function xOffset(page: Page) {
	return surface(page).evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
}

test.beforeEach(async ({ page }) => {
	await page.goto('/interaction-lab');
	await expect(page.locator('.workspace')).toHaveAttribute('data-ready', 'true');
	await expect(page.getByRole('button', { name: 'Open channels' })).toBeVisible();
});

test('P2 finger tracking, P3 chat peek, and P5 bounded release', async ({ page }) => {
	const box = await page.locator('.transcript').boundingBox();
	const x = 110,
		y = box!.y + 50;
	const session = await begin(page, x, y);
	await move(session, x + 40, y);
	await move(session, x + 100, y);
	await expect.poll(() => xOffset(page)).toBeGreaterThan(95);
	expect(await xOffset(page)).toBeLessThan(105);
	await move(session, x + 190, y);
	await end(session);
	await expect(page.getByRole('navigation', { name: 'Channels' })).toHaveAttribute(
		'aria-hidden',
		'false'
	);
	await expect.poll(() => xOffset(page)).toBeCloseTo(320, 0);
	const peek = await page
		.getByRole('button', { name: 'Return to chat', exact: true })
		.boundingBox();
	const viewport = page.viewportSize()!;
	expect(viewport.width - peek!.x).toBeGreaterThanOrEqual(48);
	await page
		.getByRole('button', { name: 'Return to chat', exact: true })
		.click({ position: { x: 20, y: 40 } });
	await expect.poll(() => xOffset(page)).toBeCloseTo(0, 0);
});

test('P7 vertical scroll retains ownership and P9 pointer cancellation returns to committed state', async ({
	page
}) => {
	const box = await page.locator('.transcript').boundingBox();
	const y = box!.y + 100;
	const vertical = await begin(page, 180, y);
	await move(vertical, 182, y - 40);
	await end(vertical);
	expect(await xOffset(page)).toBe(0);
	const horizontal = await begin(page, 110, y);
	await move(horizontal, 240, y);
	await expect.poll(() => xOffset(page)).toBeGreaterThan(100);
	await horizontal.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
	await horizontal.detach();
	await expect.poll(() => xOffset(page)).toBeCloseTo(0, 0);
});

test('P10 Back and Escape close panels while P11 retains draft and transcript position', async ({
	page
}) => {
	await page.getByRole('textbox', { name: 'Message draft' }).fill('A draft that must stay');
	await page.locator('.transcript').evaluate((el) => {
		el.scrollTop = 70;
	});
	const previous = await page.locator('.transcript').evaluate((el) => el.scrollTop);
	await page.getByRole('button', { name: 'Open details' }).click();
	await expect(page.getByRole('complementary', { name: 'Channel inspector' })).toHaveAttribute(
		'aria-hidden',
		'false'
	);
	await page.goBack();
	await expect(page.getByRole('button', { name: 'Open details' })).toBeFocused();
	await expect(page.getByRole('textbox', { name: 'Message draft' })).toHaveValue(
		'A draft that must stay'
	);
	expect(await page.locator('.transcript').evaluate((el) => el.scrollTop)).toBe(previous);
	await page.getByRole('button', { name: 'Open channels' }).click();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('textbox', { name: 'Message draft' })).toBeVisible();
	await expect.poll(() => xOffset(page)).toBeCloseTo(0, 0);
});

test('P5 tap settlement stays within 240ms and reduced motion is immediate', async ({ page }) => {
	const measurement = await page.evaluate(async () => {
		const button = document.querySelector<HTMLButtonElement>('[data-open-navigation]')!;
		const chat = document.querySelector<HTMLElement>('[data-chat-surface]')!;
		const start = performance.now();
		button.click();
		let first = -1;
		for (let frame = 0; frame < 90; frame++) {
			await new Promise(requestAnimationFrame);
			const x = new DOMMatrix(getComputedStyle(chat).transform).m41;
			if (x > 1 && first < 0) first = performance.now() - start;
			if (Math.abs(x - 320) < 0.5) return { firstMs: first, settleMs: performance.now() - start };
		}
		return { firstMs: first, settleMs: 1500 };
	});
	expect(measurement.firstMs).toBeLessThan(60);
	expect(measurement.settleMs).toBeLessThanOrEqual(240);
	console.log('Pane lab tap timing', measurement);
	await page.goBack();
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.getByRole('button', { name: 'Open details' }).click();
	expect(await surface(page).evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
});

test('P12 screenshots show coherent compact and desktop layouts in both themes', async ({
	page
}, info) => {
	for (const theme of ['light', 'dark']) {
		if (theme === 'dark') await page.getByRole('button', { name: 'Dark theme' }).click();
		await page.getByRole('button', { name: 'Open channels' }).click();
		await expect.poll(() => xOffset(page)).toBeCloseTo(320, 0);
		await page.screenshot({ path: info.outputPath(`mobile-${theme}.png`) });
		await page.goBack();
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.getByRole('button', { name: 'Open details' }).click();
		await expect(page.locator('.workspace')).toHaveClass(/wide/);
		await page.screenshot({ path: info.outputPath(`desktop-${theme}.png`) });
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		await page.goBack();
		await page.setViewportSize({ width: 412, height: 915 });
	}
});

test('S1 touch targets stay generous on phones and wide touchscreens', async ({ page }) => {
	for (const width of [320, 412, 1440]) {
		await page.setViewportSize({ width, height: 915 });
		if (width < 1100) await page.getByRole('button', { name: 'Open channels' }).click();
		const rows = await page.locator('.channel').evaluateAll((els) =>
			els.map((el) => {
				const { width, height } = el.getBoundingClientRect();
				return { width, height };
			})
		);
		for (const row of rows) {
			expect(row.width).toBeGreaterThanOrEqual(48);
			expect(row.height).toBeGreaterThanOrEqual(48);
		}
		expect(await page.locator('.channels').evaluate((el) => getComputedStyle(el).gap)).toBe('8px');
		if (width < 1100) await page.goBack();
		const controls = await page.locator('.pane-control:visible').evaluateAll((els) =>
			els.map((el) => {
				const { width, height } = el.getBoundingClientRect();
				return { width, height };
			})
		);
		for (const control of controls) {
			expect(control.width).toBeCloseTo(48, 2);
			expect(control.height).toBeCloseTo(48, 2);
		}
	}
});

test('S2 short viewports and enlarged text preserve the composer and inspector scroll', async ({
	page
}) => {
	for (const width of [320, 412]) {
		await page.setViewportSize({ width, height: 600 });
		await page.evaluate(() => {
			document.documentElement.style.fontSize = '32px';
		});
		await expect
			.poll(async () => {
				const composer = await page.getByRole('textbox', { name: 'Message draft' }).boundingBox();
				return composer!.y + composer!.height;
			})
			.toBeLessThanOrEqual(600);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		await page.getByRole('button', { name: 'Open details' }).click();
		await page.getByRole('button', { name: 'Return to conversation' }).scrollIntoViewIfNeeded();
		const action = await page.getByRole('button', { name: 'Return to conversation' }).boundingBox();
		expect(action!.y + action!.height).toBeLessThanOrEqual(600);
		await page.goBack();
		await page.evaluate(() => {
			document.documentElement.style.fontSize = '16px';
		});
	}
	await page.setViewportSize({ width: 412, height: 420 });
	await expect
		.poll(async () => {
			const composer = await page.getByRole('textbox', { name: 'Message draft' }).boundingBox();
			return composer!.y + composer!.height;
		})
		.toBeLessThanOrEqual(420);
});

test('S3 compact navigation requires a mouse-only desktop', async ({ browser, baseURL }) => {
	const desktop = await browser.newContext({
		baseURL,
		viewport: { width: 1440, height: 1000 },
		isMobile: false,
		hasTouch: false
	});
	try {
		const page = await desktop.newPage();
		await page.goto('/interaction-lab');
		await expect(page.locator('.workspace')).toHaveClass(/wide/);
		const row = await page.locator('.channel').first().boundingBox();
		expect(row!.height).toBeCloseTo(36, 2);
		expect(await page.locator('.channels').evaluate((el) => getComputedStyle(el).gap)).toBe('2px');
		await page.getByRole('button', { name: 'Open details' }).click();
		await expect(page.getByRole('button', { name: 'Close details' })).toBeVisible();
		await page.getByRole('button', { name: 'Close details' }).click();
		await expect(page.getByRole('button', { name: 'Open details' })).toBeFocused();
	} finally {
		await desktop.close();
	}
});
