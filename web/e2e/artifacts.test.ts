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

test('long artifact renders Markdown before and after navigating to a shorter document', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	const shortId = '00000000-0000-4000-8000-000000000002';
	const long = {
		...document,
		content:
			'# Long report\n\n' +
			'Detailed report findings. '.repeat(800) +
			'\n\n## Next steps\n\n**Review** the evidence.\n\n| Item | Status |\n| --- | --- |\n| Report | Ready |'
	};
	const short = { ...document, id: shortId, title: 'Short report', content: '# Summary\n\nReady.' };
	await context.route('**/api/artifacts**', (route) => {
		const path = new URL(route.request().url()).pathname;
		return route.fulfill({
			json: path.endsWith(id)
				? long
				: path.endsWith(shortId)
					? short
					: { artifacts: [long, short], truncated: false }
		});
	});
	await page.goto(`/artifacts/${id}`);
	await expect(page.getByRole('heading', { name: 'Long report', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Next steps' })).toBeVisible();
	await expect(page.locator('article strong')).toHaveText('Review');
	await expect(page.getByRole('table')).toContainText('Ready');
	await page.getByRole('link', { name: 'Artifacts', exact: true }).click();
	await page.getByRole('link', { name: /Short report/ }).click();
	await expect(page.getByRole('heading', { name: 'Summary', exact: true })).toBeVisible();
	await page.goBack();
	await page.getByRole('link', { name: /Quarterly report/ }).click();
	await expect(page.getByRole('heading', { name: 'Next steps' })).toBeVisible();
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Next steps' })).toBeVisible();
});
