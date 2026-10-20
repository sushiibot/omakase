import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { fixtureApp } from './helpers';

// Message links (docs/message-links.md): `<conversation path>?m=<message id>` opens the history
// around the message, centred, focused, tinted, with "Jump to latest" while away from the newest.

const at = (i: number) => new Date(Date.UTC(2026, 8, 1, 9, i)).toISOString();
const all = Array.from({ length: 200 }, (_, i) => ({
	type: 'assistant',
	id: String(i + 1),
	at: at(i + 1),
	text: `Reply number ${i + 1}.`,
	outboxId: `outbox-${String(i + 1).padStart(4, '0')}`,
	tools: [],
	files: []
}));
const key = (n: number) => `outbox-${String(n).padStart(4, '0')}`;

/** The gateway's history paging over `all`, with indexes as cursors. */
async function history(context: BrowserContext) {
	const calls: string[] = [];
	await context.route('**/api/chat/history?*', (route) => {
		const q = new URL(route.request().url()).searchParams;
		const limit = Number(q.get('limit') ?? 40);
		const around = q.get('around');
		const after = q.get('after');
		const before = q.get('before');
		calls.push(q.toString());
		if (around) {
			const i = all.findIndex((h) => h.outboxId === around || `s${h.id}` === around);
			if (i < 0)
				return route.fulfill({
					json: {
						items: all.slice(-40),
						before: String(all.length - 40),
						after: null,
						target: null,
						missing: true
					}
				});
			const start = Math.max(0, i - limit / 2);
			const end = Math.min(all.length, i + limit / 2 + 1);
			return route.fulfill({
				json: {
					items: all.slice(start, end),
					before: start > 0 ? String(start) : null,
					after: end < all.length ? String(end) : null,
					target: all[i].id
				}
			});
		}
		if (after) {
			const start = Number(after);
			const end = Math.min(all.length, start + limit);
			return route.fulfill({
				json: {
					items: all.slice(start, end),
					before: String(start),
					after: end < all.length ? String(end) : null
				}
			});
		}
		const end = before ? Number(before) : all.length;
		const start = Math.max(0, end - limit);
		return route.fulfill({
			json: { items: all.slice(start, end), before: start > 0 ? String(start) : null }
		});
	});
	return calls;
}

const row = (page: Page, n: number) => page.locator(`[data-message-key="${key(n)}"]`);

test('a message link lands on an old message, focused and tinted, and Jump to latest returns', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	const calls = await history(context);
	await page.goto(`/chat?m=${key(20)}`);
	await expect(row(page, 20)).toBeFocused();
	await expect(row(page, 20)).toBeInViewport();
	await expect(row(page, 20)).toHaveAttribute('data-landed', /tint|fade/);
	expect(calls.some((c) => c.includes(`around=${key(20)}`))).toBe(true);
	await expect(
		page.getByRole('status').filter({ hasText: 'Showing a message from' })
	).toBeAttached();
	// The tint fades on its own.
	await expect(row(page, 20)).not.toHaveAttribute('data-landed', /.+/, { timeout: 4000 });
	const bar = page.locator('[data-detached-bar]');
	await expect(bar).toContainText('Earlier messages');
	await bar.getByRole('button', { name: 'Jump to latest' }).click();
	await expect(bar).toHaveCount(0);
	await expect(page).toHaveURL(/\/chat$/);
	await expect(row(page, 200)).toBeInViewport();
});

test('scrolling down a window loads newer pages and joins the live chat', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await history(context);
	await page.goto(`/chat?m=${key(120)}`);
	await expect(row(page, 120)).toBeFocused();
	const list = page.locator('main');
	for (let i = 0; i < 30 && (await page.locator('[data-detached-bar]').count()); i++) {
		await list.evaluate((el) => el.scrollTo({ top: 0, behavior: 'instant' }));
		await page.waitForTimeout(100);
	}
	await expect(page.locator('[data-detached-bar]')).toHaveCount(0);
	await expect(row(page, 200)).toBeAttached();
	await expect(row(page, 120)).toBeAttached();
	expect(await page.locator(`[data-message-key="${key(150)}"]`).count()).toBe(1);
});

test('Back from a landed link returns to the newest messages', async ({ page, context }) => {
	await fixtureApp(context);
	await history(context);
	await page.goto('/chat');
	await expect(row(page, 200)).toBeAttached();
	await page.evaluate(
		(href) => {
			const a = document.createElement('a');
			a.href = href;
			a.textContent = 'Linked message';
			a.id = 'test-link';
			document.body.firstElementChild!.append(a);
		},
		`/chat?m=${key(20)}`
	);
	await page.locator('#test-link').click();
	await expect(row(page, 20)).toBeFocused();
	await expect(page.locator('[data-detached-bar]')).toBeVisible();
	await page.goBack();
	await expect(page).toHaveURL(/\/chat$/);
	await expect(page.locator('[data-detached-bar]')).toHaveCount(0);
	await expect(row(page, 200)).toBeAttached();
});

test('a link to a message that is gone opens at the newest with a notice', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await history(context);
	await page.goto('/chat?m=gone-message-1');
	await expect(page.locator('[data-link-status]')).toContainText(
		'That message is no longer available.'
	);
	await expect(page.locator('[data-detached-bar]')).toHaveCount(0);
	await expect(row(page, 200)).toBeInViewport();
});

test('under reduced motion the landing is an outline until the next interaction', async ({
	page,
	context
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await fixtureApp(context);
	await history(context);
	await page.goto(`/chat?m=${key(20)}`);
	await expect(row(page, 20)).toHaveAttribute('data-landed', 'outline');
	await page.waitForTimeout(2500);
	await expect(row(page, 20)).toHaveAttribute('data-landed', 'outline');
	await page.keyboard.press('Shift');
	await expect(row(page, 20)).not.toHaveAttribute('data-landed', /.+/);
});

test('Copy link copies the message’s own link', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await fixtureApp(context);
	await history(context);
	await page.goto('/chat');
	const last = row(page, 200);
	await last.hover();
	await last.getByRole('button', { name: 'Copy link' }).click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		`${new URL(page.url()).origin}/chat?m=${key(200)}`
	);
	await expect(last.getByRole('button', { name: 'Copy link' })).toBeVisible();
});
