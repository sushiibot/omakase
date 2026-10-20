import { expect, test, type BrowserContext } from '@playwright/test';
import { axe, fixtureApp, horizontalOverflow } from './helpers';
import { SAVED_IDS, SAVED_SOURCES } from '../src/lib/features/saved/fixtures';
import { liveBlocks, newLiveBlock } from '../src/lib/features/chat/render/rich/live';

// Saved items (/api mocked by e2e/fixture-routes.ts): the library, the item page, the side panel's
// Saved tab, Home's "In use", and Pin/Open on a stored block in chat.

for (const width of [412, 1440]) {
	test(`the library groups by conversation, filters by kind and status, and searches at ${width}px`, async ({
		page,
		context
	}) => {
		await fixtureApp(context);
		await page.setViewportSize({ width, height: 915 });
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto('/workspace');
		await page.getByRole('link', { name: /^Saved/ }).click();
		await expect(page).toHaveURL(/\/saved$/);
		await expect(page.getByRole('heading', { name: 'Saved', exact: true })).toBeVisible();
		// Active by default: Pinned first, then one group per source conversation.
		const headings = page.locator('main').getByRole('heading', { level: 2 });
		await expect(headings.first()).toHaveText(/Pinned/);
		await expect(page.getByRole('heading', { name: 'October trip' })).toBeVisible();
		const groceries = page.locator(`[data-saved-row="${SAVED_IDS.groceries}"]`);
		await expect(groceries).toContainText('1 of 3 done');
		await expect(groceries).toContainText('From');
		await expect(page.locator(`[data-saved-row="${SAVED_IDS.tea}"]`)).toContainText(
			/Running · ends/
		);
		await expect(page.getByRole('link', { name: /Moving day/ })).toHaveCount(0);

		await page.getByRole('radio', { name: 'Done' }).click();
		await expect(page).toHaveURL(/status=done/);
		await expect(page.getByRole('link', { name: /Moving day/ })).toBeVisible();
		await expect(page.getByRole('link', { name: /Groceries/ })).toHaveCount(0);
		await page.getByRole('radio', { name: 'Active' }).click();

		await page.getByRole('radio', { name: 'Docs' }).click();
		await expect(page).toHaveURL(/kind=docs/);
		await expect(page.locator('[data-saved-row]')).toHaveCount(1);
		await expect(page.getByRole('link', { name: /October trip plan/ })).toBeVisible();
		await page.getByRole('radio', { name: 'All', exact: true }).click();

		// Search reads document content too.
		await page.getByRole('searchbox').fill('Friday');
		await expect(page.locator('[data-saved-row]')).toHaveCount(1);
		await expect(page.getByRole('link', { name: /October trip plan/ })).toBeVisible();
		await page.getByRole('searchbox').fill('nothing like this');
		await expect(page.getByText('No matching items')).toBeVisible();
		await page.getByRole('button', { name: 'Clear search' }).click();
		await expect(page.locator(`[data-saved-row="${SAVED_IDS.groceries}"]`)).toBeVisible();

		expect(await horizontalOverflow(page)).toEqual([]);
		expect(await axe(page)).toEqual([]);
		expect(errors).toEqual([]);
	});
}

for (const width of [412, 1440]) {
	test(`a document's page links back to its reply, and pins and archives at ${width}px`, async ({
		page,
		context
	}) => {
		await fixtureApp(context);
		await page.setViewportSize({ width, height: 915 });
		const acts: unknown[] = [];
		page.on('request', (req) => {
			if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/saved')
				acts.push(req.postDataJSON());
		});
		await page.goto('/saved?kind=docs');
		await page.getByRole('link', { name: /October trip plan/ }).click();
		await expect(page).toHaveURL(`/saved/document/${SAVED_IDS.plan}`);
		await expect(
			page.getByRole('heading', { name: 'October trip plan', exact: true })
		).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Bookings' })).toBeVisible();
		const from = page.locator('[data-saved-provenance]').getByRole('link');
		await expect(from).toHaveText('October trip');
		await expect(from).toHaveAttribute('href', `/chats/oct-trip?m=${SAVED_SOURCES.plan}`);
		await expect.poll(() => acts).toContainEqual({ action: 'opened', id: SAVED_IDS.plan });

		const pin = page.getByRole('button', { name: 'Pin', exact: true });
		await expect(pin).toHaveAttribute('aria-pressed', 'false');
		await pin.click();
		await expect(pin).toHaveAttribute('aria-pressed', 'true');
		await page.getByRole('button', { name: 'Archive', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
		await expect(page.locator('[data-saved-provenance]')).toContainText('Archived');
		await expect(pin).toHaveAttribute('aria-pressed', 'false');
		expect(acts).toContainEqual({ action: 'pin', id: SAVED_IDS.plan });
		expect(acts).toContainEqual({ action: 'archive', id: SAVED_IDS.plan });
		expect(await horizontalOverflow(page)).toEqual([]);
		expect(await axe(page)).toEqual([]);

		// The chat's document link opens the same page.
		await page.goto(`/artifacts/${SAVED_IDS.plan}`);
		await expect(
			page.getByRole('heading', { name: 'October trip plan', exact: true })
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
		await page.getByRole('link', { name: 'Saved', exact: true }).click();
		await expect(page).toHaveURL(/\/saved$/);
	});
}

test('a checklist page is the live block itself: ticks sync and the From link lands on its reply', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await page.setViewportSize({ width: 412, height: 915 });
	const changes: unknown[] = [];
	page.on('request', (req) => {
		if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/blocks')
			changes.push(req.postDataJSON());
	});
	await page.goto(`/saved/checklist/${SAVED_IDS.groceries.replace('.', '~')}`);
	await expect(page.getByRole('heading', { name: 'Groceries', exact: true })).toBeVisible();
	await expect(page.locator('[data-saved-provenance]').getByRole('link')).toHaveAttribute(
		'href',
		`/chat?m=${SAVED_SOURCES.groceries}`
	);
	const figure = page.getByRole('figure');
	await expect(figure.getByText('1 of 3 done')).toBeVisible();
	await figure.getByRole('checkbox', { name: 'Eggs' }).click();
	await expect(figure.getByText('2 of 3 done')).toBeVisible();
	expect(changes).toEqual([
		{ id: SAVED_IDS.groceries, ops: [{ op: 'check', item: 1, done: true }] }
	]);
	await figure.getByRole('textbox', { name: 'Add an item' }).fill('Bread');
	await figure.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(figure.getByText('Bread')).toBeVisible();
	await page.reload();
	await expect(page.getByRole('figure').getByText('2 of 4 done')).toBeVisible();
	expect(await axe(page)).toEqual([]);
});

async function openSavedTab(page: import('@playwright/test').Page) {
	await page
		.getByRole('button', { name: /^Tasks/ })
		.first()
		.click();
	await page.getByRole('tab', { name: 'Saved' }).click();
	return page.locator('[data-saved-panel]');
}

for (const width of [412, 1440]) {
	test(`the side panel's Saved tab lists this conversation's items at ${width}px`, async ({
		page,
		context
	}) => {
		await fixtureApp(context);
		await page.setViewportSize({ width, height: 915 });
		await page.goto('/chat');
		const panel = await openSavedTab(page);
		await expect(panel.getByRole('heading', { name: /Active/ })).toBeVisible();
		await expect(panel.locator('[data-saved-row]')).toHaveCount(3);
		await expect(panel.getByRole('link', { name: /Groceries/ })).toBeVisible();
		await expect(panel.getByRole('link', { name: /Pancakes/ })).toBeVisible();
		await expect(panel.getByRole('link', { name: /October trip plan/ })).toHaveCount(0);
		expect(await horizontalOverflow(page)).toEqual([]);

		await page.goto('/chats/oct-trip');
		const trip = await openSavedTab(page);
		await expect(trip.getByRole('link', { name: /October trip plan/ })).toBeVisible();
		await expect(trip.getByRole('link', { name: /Packing list/ })).toBeVisible();
		await expect(trip.getByRole('link', { name: /Groceries/ })).toHaveCount(0);
	});
}

for (const width of [320, 1440]) {
	test(`Home shows saved items in use after Working now at ${width}px`, async ({
		page,
		context
	}) => {
		await fixtureApp(context);
		await page.setViewportSize({ width, height: 1000 });
		await page.goto('/assistant');
		const overview = page.locator('[data-assistant-home]');
		const section = overview.locator('[data-saved-in-use]');
		await expect(overview.getByRole('heading', { name: /In use/ })).toBeVisible();
		// Pinned, then the running timer, then open checklists; a recipe isn't "in use".
		await expect(section.locator('[data-saved-row]')).toHaveCount(3);
		await expect(section.locator('[data-saved-row]').first()).toContainText('Groceries');
		await expect(section.locator('[data-saved-row]').nth(1)).toContainText('Tea');
		await expect(section.getByRole('link', { name: /Pancakes/ })).toHaveCount(0);
		expect(await horizontalOverflow(page)).toEqual([]);
		await overview.getByRole('link', { name: 'All saved' }).click();
		await expect(page).toHaveURL(/\/saved$/);
	});
}

const KEY = '01JSAVEDCHATREPLY000000000';
const reply = 'Here is the list:\n\n```checklist\ntitle: Camping\nitems: [tent, stove]\n```';

async function chatWithBlock(context: BrowserContext) {
	await fixtureApp(context, {
		history: [
			{
				type: 'assistant',
				id: 'h:a1',
				at: new Date(Date.now() - 60_000).toISOString(),
				text: reply,
				outboxId: KEY,
				tools: [],
				files: []
			}
		]
	});
	const block = newLiveBlock(liveBlocks(reply)[0], KEY, 'main', new Date());
	const item = {
		kind: 'checklist',
		id: block.id,
		title: 'Camping',
		conversationId: 'main',
		sourceMessageId: KEY,
		status: 'active',
		pinned: false,
		archived: false,
		createdAt: block.createdAt,
		updatedAt: block.updatedAt,
		updatedBy: 'agent',
		summary: '0 of 2 done',
		progress: { done: 0, total: 2 }
	};
	const acts: unknown[] = [];
	await context.route('**/api/blocks**', (route) => route.fulfill({ json: { blocks: [block] } }));
	await context.route('**/api/saved**', (route) => {
		if (route.request().method() === 'POST') {
			const body = route.request().postDataJSON();
			acts.push(body);
			item.pinned = body.action === 'pin';
			return route.fulfill({ json: { items: [item] } });
		}
		return route.fulfill({ json: { items: [item] } });
	});
	return { block, acts };
}

test('a stored checklist in chat offers Pin and Open', async ({ page, context }) => {
	const { block, acts } = await chatWithBlock(context);
	await page.setViewportSize({ width: 412, height: 915 });
	await page.goto('/chat');
	const list = page.getByRole('figure').filter({ hasText: 'Camping' });
	await expect(list.getByRole('textbox', { name: 'Add an item' })).toBeVisible();
	const pin = page.getByRole('button', { name: 'Pin', exact: true });
	await expect(pin).toHaveAttribute('aria-pressed', 'false');
	await pin.click();
	await expect(pin).toHaveAttribute('aria-pressed', 'true');
	expect(acts).toEqual([{ action: 'pin', id: block.id }]);
	await expect(page.getByRole('link', { name: 'Open Camping' })).toHaveAttribute(
		'href',
		`/saved/checklist/${block.id.replace('.', '~')}`
	);
});
