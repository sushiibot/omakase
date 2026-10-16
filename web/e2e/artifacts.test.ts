import { expect, test } from '@playwright/test';
import { fixtureApp, horizontalOverflow } from './helpers';
const id = '00000000-0000-4000-8000-000000000001';
const document = {
	id,
	title: 'Quarterly report',
	content: '# Findings\n\nRevenue grew this quarter.',
	createdAt: '2026-10-01T00:00:00Z',
	updatedAt: '2026-10-16T00:00:00Z',
	version: 2,
	conversationId: 'main'
};
for (const width of [412, 1440]) {
	test(`artifact library search and reader at ${width}px`, async ({ page, context }) => {
		await fixtureApp(context);
		await page.setViewportSize({ width, height: 915 });
		await context.route('**/api/artifacts**', (route) => {
			const url = new URL(route.request().url());
			const query = url.searchParams.get('q') ?? '';
			return route.fulfill({
				json: url.pathname.endsWith(id)
					? document
					: { artifacts: query === 'absent' ? [] : [document], truncated: false }
			});
		});
		await page.goto('/artifacts');
		await expect(page.getByRole('heading', { name: 'Artifacts', exact: true })).toBeVisible();
		await page.getByRole('searchbox').fill('absent');
		await expect(page.getByText('No matching documents')).toBeVisible();
		await page.getByRole('searchbox').fill('Revenue');
		await page.getByRole('link', { name: /Quarterly report/ }).click();
		await expect(
			page.getByRole('heading', { name: 'Quarterly report', exact: true })
		).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Findings' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Open source chat' })).toHaveAttribute(
			'href',
			'/chat'
		);
		expect(await horizontalOverflow(page)).toEqual([]);
		await page.screenshot({ path: `/tmp/omakase-artifact-${width}.png` });
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Findings' })).toBeVisible();
	});
}

test('channel labels dim after opening and remain read after reload', async ({ page, context }) => {
	await fixtureApp(context);
	await page.setViewportSize({ width: 1440, height: 915 });
	const channel = {
		id: 'oct-trip',
		title: 'Trip',
		kind: 'channel',
		state: 'idle',
		lastActivity: null,
		preview: '',
		pending: { asks: 0, approvals: 0, total: 0 },
		attention: [],
		activity: { running: false, turnCount: 0 },
		headSeq: 7,
		lastMessageSeq: 7,
		unread: null
	};
	await context.route('**/api/channels', (route) =>
		route.fulfill({ json: { channels: [channel], archiveAfterDays: 7 } })
	);
	await page.goto('/workspace');
	const link = page.locator('[data-channel-list] a[href="/chats/oct-trip"]');
	await expect(link).toHaveAttribute('data-unread', 'true');
	await link.click();
	await expect(link).not.toHaveAttribute('data-unread', 'true');
	await page.reload();
	await expect(link).toBeVisible();
	await expect(link).not.toHaveAttribute('data-unread', 'true');
});
