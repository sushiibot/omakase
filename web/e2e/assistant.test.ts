import { expect, test } from '@playwright/test';
import { fixtureApp, horizontalOverflow, axe } from './helpers';
const id = '00000000-0000-4000-8000-000000000001';
const document = {
	id,
	title: 'Cupertino voter guide',
	content: '# Findings\n\nA saved report.',
	createdAt: '2026-10-16T10:00:00Z',
	updatedAt: '2026-10-16T10:00:00Z',
	conversationId: 'main',
	version: 1
};

for (const width of [320, 1440]) {
	test(`Home shows live work, resumes documents, and reviews an exact approval at ${width}px`, async ({
		page,
		context
	}) => {
		await fixtureApp(context);
		await page.setViewportSize({ width, height: 1000 });
		await context.addInitScript(() => {
			localStorage.setItem('theme', 'dark');
			const stream = (window as unknown as { __sse: { hello: { pending: unknown } } }).__sse;
			stream.hello.pending = {
				approvals: [
					{
						seq: 3,
						at: new Date().toISOString(),
						nonce: 'home-approval',
						view: {
							tool: 'calendar_update',
							agentId: 'main',
							agentName: 'Assistant',
							fields: [{ key: 'event', value: 'Friday show', kind: 'single', max: 200 }]
						}
					}
				],
				asks: []
			};
		});
		await context.route('**/api/artifacts**', (route) =>
			route.fulfill({
				json: new URL(route.request().url()).pathname.endsWith(id)
					? document
					: { artifacts: [document], truncated: false }
			})
		);
		const decisions: unknown[] = [];
		await context.route('**/api/chat/approvals/home-approval', (route) => {
			decisions.push(route.request().postDataJSON());
			return route.fulfill({ json: { ok: true } });
		});
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto('/assistant');
		await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
		const overview = page.getByRole('tabpanel', { name: 'Overview', exact: true });
		await expect(overview.getByRole('heading', { name: 'Needs you', exact: false })).toBeVisible();
		await expect(overview.getByRole('link', { name: /Cupertino voter guide/ })).toBeVisible();
		await overview.getByRole('button', { name: /Approve calendar_update/ }).click();
		const review = width >= 1280 ? page.locator('[data-home-inspector]') : page.getByRole('dialog');
		await expect(review).toContainText('Friday show');
		expect(decisions).toEqual([]);
		if (width < 1280) {
			await expect(review.getByRole('button', { name: 'Back to Home' })).toBeVisible();
			const bounds = await review.boundingBox();
			expect(bounds?.y).toBe(0);
			expect(bounds?.height).toBe(1000);
			await review.getByRole('button', { name: 'Back to Home' }).click();
			await expect(review).not.toBeVisible();
			await overview.getByRole('button', { name: /Approve calendar_update/ }).click();
			await expect(review).toBeVisible();
		}

		await page.goBack();
		await expect(review).not.toBeVisible();
		await overview.getByRole('link', { name: /Cupertino voter guide/ }).click();
		await expect(page.getByRole('heading', { name: 'Findings' })).toBeVisible();
		await page.goBack();
		await expect(overview.getByRole('heading', { name: 'Continue', exact: true })).toBeVisible();
		await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Your ongoing work' })).toBeVisible();
		await expect(page).toHaveURL(/view=following/);
		await page
			.getByRole('tabpanel', { name: 'Tasks' })
			.getByRole('link', { name: /Review the deployment notes/ })
			.click();
		await expect(page).toHaveURL(/\/tasks\/t-notes/);
		await page.goBack();
		await expect(page.getByRole('tab', { name: 'Tasks', exact: true })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await page.getByRole('tab', { name: 'History', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Finished work' })).toBeVisible();
		await page.getByRole('tab', { name: 'Overview', exact: true }).click();
		await overview.getByRole('button', { name: /Approve calendar_update/ }).click();
		await expect(review).toContainText('Friday show');
		await expect(
			review.getByRole('button', { name: 'Approve calendar_update', exact: true })
		).toBeEnabled();
		await page.screenshot({ path: `/tmp/omakase-home-${width}.png` });
		expect(await horizontalOverflow(page)).toEqual([]);
		expect(await axe(page)).toEqual([]);
		await review.getByRole('button', { name: 'Approve calendar_update', exact: true }).click();
		await expect.poll(() => decisions).toEqual([{ decision: 'approve' }]);
		expect(errors).toEqual([]);
	});
}

test('Home keeps tasks visible when documents fail and retries the failed source', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	let failing = true;
	await context.route('**/api/artifacts**', (route) =>
		failing
			? route.fulfill({ status: 503, json: { error: 'offline' } })
			: route.fulfill({ json: { artifacts: [document], truncated: false } })
	);
	await page.goto('/assistant');
	await expect(
		page.getByRole('tabpanel', { name: 'Overview' }).getByText("Couldn't load documents.")
	).toBeVisible();
	await expect(
		page.getByRole('link', { name: /Review the deployment notes/ }).first()
	).toBeVisible();
	failing = false;
	await page
		.getByRole('alert')
		.filter({ hasText: "Couldn't load documents." })
		.getByRole('button', { name: 'Try again' })
		.click();
	await expect(page.getByRole('link', { name: /Cupertino voter guide/ })).toBeVisible();
	await expect(
		page.getByRole('tabpanel', { name: 'Overview' }).getByText("Couldn't load documents.")
	).not.toBeVisible();
});

for (const width of [320, 1440]) {
	test(`review has a durable mobile-style navigation stack at ${width}px`, async ({
		page,
		context
	}) => {
		await fixtureApp(context);
		await page.setViewportSize({ width, height: 915 });
		await context.route('**/api/artifacts**', (route) =>
			route.fulfill({ json: { artifacts: [], truncated: false } })
		);
		await page.goto('/assistant');
		const overview = page.getByRole('tabpanel', { name: 'Overview' });
		const row = overview.getByRole('button', { name: /Draft the quarterly expenses summary/ });
		await row.scrollIntoViewIfNeeded();
		const position = await overview.evaluate((el) => el.scrollTop);
		await row.click();
		await expect(page).toHaveURL(/item=run/);
		const review = width >= 1280 ? page.locator('[data-home-inspector]') : page.getByRole('dialog');
		await expect(
			review.getByRole('heading', { name: 'Draft the quarterly expenses summary' })
		).toBeVisible();
		await page.reload();
		await expect(
			review.getByRole('heading', { name: 'Draft the quarterly expenses summary' })
		).toBeVisible();
		await review.getByRole('button', { name: 'View activity', exact: true }).click();
		await expect(page).toHaveURL(/\/runs\//);
		await page.goBack();
		await expect(
			review.getByRole('heading', { name: 'Draft the quarterly expenses summary' })
		).toBeVisible();
		await page.goForward();
		await expect(page).toHaveURL(/\/runs\//);
		await page.goBack();
		await expect(review).toBeVisible();
		await review
			.getByRole('button', { name: width >= 1280 ? 'Close review' : 'Back to Home', exact: true })
			.click();
		await expect(page).toHaveURL(/\/assistant$/);
		await expect(review).not.toBeVisible();
		await expect.poll(() => overview.evaluate((el) => el.scrollTop)).toBeCloseTo(position, 0);
	});
}

test('direct review link reloads and Back falls back to Home', async ({ page, context }) => {
	await fixtureApp(context);
	await context.route('**/api/artifacts**', (route) =>
		route.fulfill({ json: { artifacts: [], truncated: false } })
	);
	await page.goto('/assistant?item=job%3Anightly-sync');
	const review = page.getByRole('dialog');
	await expect(review.getByRole('heading', { name: 'nightly-sync failed' })).toBeVisible();
	await page.reload();
	await expect(review.getByRole('heading', { name: 'nightly-sync failed' })).toBeVisible();
	await review.getByRole('button', { name: 'Back to Home' }).click();
	await expect(page).toHaveURL(/\/assistant$/);
	await expect(review).not.toBeVisible();
});
