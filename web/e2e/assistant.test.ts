import { expect, test, type BrowserContext } from '@playwright/test';
import { channelFixture } from '../src/lib/features/channels/fixtures';
import { taskFixtures } from '../src/lib/features/tasks/fixtures';
import { fakeBackend } from './fake-backend';
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
	test(`Home shows live work without documents and reviews an exact approval at ${width}px`, async ({
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
		const overview = page.locator('[data-assistant-home]');
		await expect(page.getByRole('tab')).toHaveCount(0);
		await expect(overview.getByRole('heading', { name: 'Needs you', exact: false })).toBeVisible();
		await expect(overview.getByRole('button', { name: /Approve calendar_update/ })).toBeVisible();
		await expect(overview.getByRole('button', { name: 'Review', exact: true })).toHaveCount(0);
		await expect(overview.getByRole('link', { name: /Cupertino voter guide/ })).toHaveCount(0);
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
		await page.goto(`/artifacts/${id}`);
		await expect(page.getByRole('heading', { name: 'Findings' })).toBeVisible();
		await page.goBack();
		await expect(overview.getByRole('heading', { name: 'Needs you', exact: false })).toBeVisible();
		await expect(overview.getByRole('link', { name: /Cupertino voter guide/ })).toHaveCount(0);
		// Live work comes second, with each row's step, and the section links to Tasks.
		const working = overview.getByRole('region', { name: 'Working now' });
		await expect(working.getByRole('link', { name: 'All tasks' })).toHaveAttribute(
			'href',
			'/tasks'
		);
		await expect(working).toContainText('Task in progress');
		await working.getByRole('link', { name: /Review the deployment notes/ }).click();
		await expect(page).toHaveURL(/\/tasks\/t-notes/);
		await page.goBack();
		await expect(page).toHaveURL(/\/assistant$/);
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

for (const width of [320, 1440]) {
	test(`review has a durable mobile-style navigation stack at ${width}px`, async ({
		page,
		context
	}) => {
		await fixtureApp(context);
		await page.setViewportSize({ width, height: 915 });
		await page.goto('/assistant');
		const overview = page.locator('main:has([data-assistant-home])');
		const row = overview.getByRole('button', { name: /Draft the quarterly expenses summary/ });
		// Home's sections load independently; the scroll is compared once all of them are in.
		const settled = async () => {
			await expect(
				overview.getByRole('link', { name: /Review the deployment notes/ })
			).toBeVisible();
			await expect(
				overview.getByRole('link', { name: /Fix login redirect/ }).first()
			).toBeVisible();
			await expect(overview.locator('[data-saved-in-use] [data-saved-row]')).toHaveCount(3);
			await expect(overview.getByRole('button', { name: /nightly-sync failed/ })).toBeVisible();
			await expect(overview.getByRole('button', { name: /Compare flight prices/ })).toBeVisible();
			await expect(row).toBeVisible();
			await expect(overview.getByText('Loading Home…')).toHaveCount(0);
		};
		await settled();
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
		await settled();
		// The list scroll comes back to the row that was opened, not to the top. Sections arrive in
		// their own order after a reload, so the exact offset can differ by a row.
		await expect(row).toBeInViewport();
		expect(position).toBeGreaterThan(0);
		await expect.poll(() => overview.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	});
}

test('direct review link reloads and Back falls back to Home', async ({ page, context }) => {
	await fixtureApp(context);
	await page.goto('/assistant?item=job%3Anightly-sync');
	const review = page.getByRole('dialog');
	await expect(review.getByRole('heading', { name: 'nightly-sync failed' })).toBeVisible();
	await page.reload();
	await expect(review.getByRole('heading', { name: 'nightly-sync failed' })).toBeVisible();
	await review.getByRole('button', { name: 'Back to Home' }).click();
	await expect(page).toHaveURL(/\/assistant$/);
	await expect(review).not.toBeVisible();
});

const pendingApproval = () => ({
	seq: 3,
	at: new Date(Date.now() - 5 * 60_000).toISOString(),
	nonce: 'home-approval',
	view: {
		tool: 'calendar_update',
		agentId: 'main',
		agentName: 'Assistant',
		fields: [{ key: 'event', value: 'Friday show', kind: 'single', max: 200 }]
	}
});

/** Main with the approval the stream also carries, and a topic with a question Home has no record of. */
async function catalog(context: BrowserContext, opts: { quiet?: boolean } = {}) {
	const at = new Date(Date.now() - 20 * 60_000).toISOString();
	const channels = opts.quiet
		? [channelFixture('main', 'Main', { preview: 'Booked the table.', lastActivity: at })]
		: [
				channelFixture('main', 'Main', {
					state: 'needs-you',
					preview: 'Booked the table.',
					lastActivity: at,
					pending: { asks: 0, approvals: 1, total: 1 },
					attention: [{ kind: 'approval', id: 'home-approval', seq: 3, at }]
				}),
				channelFixture('trip', 'October trip', {
					state: 'needs-you',
					preview: 'Aisle 24C or window 31K?',
					lastActivity: at,
					lastMessageSeq: 9,
					pending: { asks: 1, approvals: 0, total: 1 },
					attention: [{ kind: 'ask', id: 'q-trip', seq: 8, at }]
				})
			];
	await context.route('**/api/channels', (route) =>
		route.fulfill({ json: { archiveAfterDays: 7, channels } })
	);
	await context.addInitScript(() =>
		localStorage.setItem('channels:recent:v1', JSON.stringify(['trip', 'main']))
	);
}

for (const width of [320, 1440]) {
	test(`Home's status line counts what needs you, as the menu does, at ${width}px`, async ({
		page,
		context
	}) => {
		await fixtureApp(context);
		await catalog(context);
		await page.setViewportSize({ width, height: 900 });
		await context.addInitScript((approval) => {
			const stream = (window as unknown as { __sse: { hello: { pending: unknown } } }).__sse;
			stream.hello.pending = { approvals: [approval], asks: [] };
		}, pendingApproval());
		await page.goto('/assistant');
		const home = page.locator('[data-assistant-home]');
		// The approval (in Home and Main's catalog), the topic's question and the waiting task: 3.
		await expect(home.locator('[data-home-status]')).toContainText(
			/^Good (morning|afternoon|evening)\s*3 need you · 2 failed · \d+ running · 3 ready$/
		);
		if (width < 768)
			await expect(page.getByRole('button', { name: /^Menu/ })).toHaveAccessibleName(
				'Menu, 3 need you'
			);
		else
			await expect(
				page
					.getByRole('listitem')
					.filter({ has: page.getByRole('link', { name: 'Home', exact: true }) })
					.locator('[data-sidebar="menu-badge"]')
			).toHaveText(/^3\s*need you$/);
		const needs = home.getByRole('region', { name: 'Needs you' });
		await expect(needs.getByRole('button', { name: /Approve calendar_update/ })).toBeVisible();
		await expect(
			needs.getByRole('link', { name: /Question waiting · October trip/ })
		).toHaveAttribute('href', '/chats/trip?ask=q-trip');
		await expect(needs.getByRole('link', { name: /Fix login redirect/ })).toHaveAttribute(
			'href',
			'/tasks/t-login'
		);
		await expect(needs.getByRole('button', { name: /nightly-sync failed/ })).toBeVisible();
		// Working now comes right after Needs you.
		const headings = await home.getByRole('heading', { level: 2 }).allInnerTexts();
		expect(headings.slice(0, 2)).toEqual(['Needs you', 'Working now']);
		const recent = home.getByRole('region', { name: 'Recent conversations' });
		await expect(recent.getByRole('link')).toHaveCount(2);
		await expect(recent.getByRole('link').first()).toContainText('October trip');
		await expect(recent.getByRole('link').first()).toContainText('Aisle 24C or window 31K?');
		await expect(recent.getByRole('link').first()).toContainText('new messages');
		await expect(recent.getByRole('link', { name: /^Main/ })).not.toContainText('new messages');
		const ready = home.getByRole('region', { name: 'Ready for you' });
		await expect(ready).toContainText('Wrote projects/finance/q3-summary.md');
		await page.screenshot({ path: `/tmp/omakase-home-status-${width}.png`, fullPage: true });
		expect(await horizontalOverflow(page)).toEqual([]);
		expect(await axe(page)).toEqual([]);
	});

	test(`the quick ask sends to Main and opens it at ${width}px`, async ({ page, context }) => {
		await fixtureApp(context);
		await page.setViewportSize({ width, height: 900 });
		const sent: { text: string }[] = [];
		await context.route('**/api/chat/messages', (route) => {
			sent.push(route.request().postDataJSON());
			return route.fulfill({ status: 202, json: { seq: 1, routed: true } });
		});
		await page.goto('/assistant');
		const box = page.getByRole('textbox', { name: 'Ask Main', exact: true });
		await expect(box).toBeVisible();
		const needs = page.getByRole('heading', { name: 'Needs you' });
		const boxBounds = (await box.boundingBox())!;
		if (width < 768) expect(boxBounds.y + boxBounds.height).toBeGreaterThan(900 - 120);
		else expect(boxBounds.y).toBeLessThan((await needs.boundingBox())!.y);
		await box.fill('What is on my calendar?');
		// The draft survives a reload.
		await page.reload();
		await expect(box).toHaveValue('What is on my calendar?');
		await page.getByRole('button', { name: 'Send to Main', exact: true }).click();
		await expect(page).toHaveURL(/\/chat$/);
		await expect(page.getByText('What is on my calendar?')).toBeVisible();
		await expect.poll(() => sent.map((s) => s.text)).toEqual(['What is on my calendar?']);
		await page.goBack();
		await expect(page).toHaveURL(/\/assistant$/);
		await expect(box).toHaveValue('');
	});
}

test('a quiet Home says all clear, lists recent finished work and keeps the quick ask', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await fakeBackend(context, { home: 'empty' });
	await catalog(context, { quiet: true });
	const done = {
		...taskFixtures[0]!,
		id: 't-done',
		title: 'Renew the parking permit',
		status: 'done' as const,
		// Recently finished only shows the last week.
		updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
		workConversationId: undefined
	};
	await context.route('**/api/tasks', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { tasks: [done] } })
			: route.fallback()
	);
	// Nothing in use either: a pinned list or running timer keeps Home from being quiet.
	await context.route('**/api/saved**', (route) =>
		route.request().method() === 'GET' ? route.fulfill({ json: { items: [] } }) : route.fallback()
	);
	await page.goto('/assistant');
	const home = page.locator('[data-assistant-home]');
	await expect(home.locator('[data-home-status]')).toContainText('All clear');
	await expect(home.getByRole('heading', { name: 'Needs you' })).toHaveCount(0);
	const finished = home.getByRole('region', { name: 'Recently finished' });
	await expect(finished.getByRole('link', { name: /Renew the parking permit/ })).toBeVisible();
	await expect(finished.getByRole('link', { name: 'Open Activity' })).toHaveAttribute(
		'href',
		'/runs'
	);
	await expect(page.getByRole('textbox', { name: 'Ask Main', exact: true })).toBeVisible();
	await page.screenshot({ path: '/tmp/omakase-home-quiet.png' });
	expect(await axe(page)).toEqual([]);
});
