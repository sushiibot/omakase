import { expect, test, type BrowserContext } from '@playwright/test';
import { fixtureApp, checkScreen } from './helpers';
test.setTimeout(60_000);
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const password = 'Only-On-Demand!9';
const account = {
	id,
	name: 'Example account',
	origin: 'https://example.com',
	username: 'owner@example.com',
	status: 'pending',
	version: 2,
	confirmedVersion: 1,
	createdAt: 1700000000000,
	updatedAt: 1700000000000
};
async function mock(context: BrowserContext) {
	await fixtureApp(context);
	const requests: { method: string; path: string; body: unknown }[] = [];
	await context.route('**/api/accounts**', async (route) => {
		const req = route.request();
		const path = new URL(req.url()).pathname;
		requests.push({ method: req.method(), path, body: req.postDataJSON() });
		if (path.endsWith('/reveal'))
			return route.fulfill({ json: { password, version: req.postDataJSON().version } });
		if (path.endsWith('/archive'))
			return route.fulfill({ json: { account: { ...account, status: 'archived' } } });
		if (path.endsWith('/audit'))
			return route.fulfill({
				json: {
					events: [
						{
							id: 'event',
							accountId: id,
							action: 'prepare',
							actor: 'agent',
							version: 2,
							at: 1700000000000
						}
					]
				}
			});
		return route.fulfill({ json: { accounts: [account] } });
	});
	return requests;
}
test('accounts are reachable; passwords load only on demand and clear on expiry and navigation', async ({
	page,
	context
}) => {
	const requests = await mock(context);
	await page.goto('/connectors');
	await page.getByRole('link', { name: /Accounts Passwords/ }).click();
	await expect(page.getByRole('heading', { name: 'Example account' })).toBeVisible();
	expect(requests.filter((r) => r.path.endsWith('/reveal'))).toHaveLength(0);
	await page.clock.install();
	await page.getByRole('button', { name: 'Reveal password', exact: true }).click();
	await expect(page.getByLabel('Revealed password')).toHaveText(password);
	expect(requests.at(-1)).toMatchObject({
		method: 'POST',
		body: { version: 2, purpose: 'reveal' }
	});
	await page.clock.fastForward(30_001);
	await expect(page.getByLabel('Revealed password')).toHaveCount(0);
	await page.getByRole('button', { name: 'Reveal last confirmed password' }).click();
	await expect(page.getByLabel('Revealed password')).toBeVisible();
	expect(requests.at(-1)?.body).toEqual({ version: 1, purpose: 'reveal' });
	await page.getByRole('link', { name: 'Connectors', exact: true }).click();
	await page.getByRole('link', { name: /Accounts Passwords/ }).click();
	await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
	await expect(page.getByLabel('Revealed password')).toHaveCount(0);
	expect(
		await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))
	).not.toContain(password);
});
test('copy is audited without revealing, history loads on demand, archive requires an explicit decision', async ({
	page,
	context
}) => {
	const requests = await mock(context);
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.goto('/accounts');
	await page.getByRole('button', { name: 'Copy password', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Password copied.' })).toBeVisible();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(password);
	await expect(page.getByLabel('Revealed password')).toHaveCount(0);
	expect(requests.at(-1)?.body).toEqual({ version: 2, purpose: 'copy' });
	await page.getByRole('button', { name: 'Reveal last confirmed password' }).click();
	await expect(page.getByLabel('Revealed password')).toBeVisible();
	await page.getByRole('button', { name: 'Copy password', exact: true }).click();
	await expect(page.getByLabel('Revealed password')).toHaveCount(0);
	await expect.poll(() => requests.at(-1)?.body).toEqual({ version: 1, purpose: 'copy' });
	expect(requests.filter((r) => r.path.endsWith('/audit'))).toHaveLength(0);
	await page.getByRole('button', { name: 'Account history' }).click();
	await expect(page.getByText('Password prepared · Version 2')).toBeVisible();
	await page.getByRole('button', { name: 'Archive', exact: true }).click();
	expect(requests.filter((r) => r.path.endsWith('/archive'))).toHaveLength(0);
	await page.getByRole('button', { name: 'Archive account', exact: true }).click();
	await expect(page.getByText('Archived · Version 2', { exact: false })).toBeVisible();
	expect(requests.find((r) => r.path.endsWith('/archive'))).toMatchObject({
		method: 'POST',
		body: { expectedVersion: 2 }
	});
	await expect(page.getByRole('button', { name: 'Archive', exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'Account history' }).click();
	await page.getByRole('button', { name: 'Reveal password', exact: true }).click();
	await expect(page.getByLabel('Revealed password')).toHaveText(password);
	await page.getByRole('button', { name: 'Copy password', exact: true }).click();
	await expect.poll(() => requests.at(-1)?.body).toEqual({ version: 2, purpose: 'copy' });
	await expect(page.getByLabel('Revealed password')).toHaveCount(0);
	await page.getByRole('button', { name: 'Reveal last confirmed password' }).click();
	await expect(page.getByLabel('Revealed password')).toBeVisible();
	await page.getByRole('button', { name: 'Copy password', exact: true }).click();
	await expect.poll(() => requests.at(-1)?.body).toEqual({ version: 1, purpose: 'copy' });
});
test('errors never echo server content and refresh recovers', async ({ page, context }) => {
	await mock(context);
	await context.route('**/api/accounts', (route) =>
		route.fulfill({ status: 500, json: { error: password } })
	);
	await page.goto('/accounts');
	await expect(page.getByRole('alert')).toHaveText('Could not load accounts. Try refreshing.');
	await expect(page.getByText(password)).toHaveCount(0);
	await context.unroute('**/api/accounts');
	await page.getByRole('button', { name: 'Refresh accounts' }).click();
	await page.getByRole('button', { name: 'Reveal password', exact: true }).click();
	await expect(page.getByLabel('Revealed password')).toBeVisible();
	await page.evaluate(() => {
		Object.defineProperty(document, 'hidden', { configurable: true, value: true });
		document.dispatchEvent(new Event('visibilitychange'));
	});
	await expect(page.getByLabel('Revealed password')).toHaveCount(0);
});
for (const dark of [false, true])
	test(`accounts reflow and accessibility (${dark ? 'dark' : 'light'})`, async ({
		page,
		context
	}) => {
		await mock(context);
		await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
		await page.setViewportSize({ width: 320, height: 740 });
		await page.goto('/accounts');
		await expect(page.getByRole('heading', { name: 'Example account' })).toBeVisible();
		await checkScreen(page);
		await page.screenshot({ path: `/tmp/omakase-accounts-${dark ? 'dark' : 'light'}-mobile.png` });
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.screenshot({ path: `/tmp/omakase-accounts-${dark ? 'dark' : 'light'}-desktop.png` });
	});

test('a late reveal response cannot restore a hidden password', async ({ page, context }) => {
	await mock(context);
	let release: (() => void) | undefined;
	const waiting = new Promise<void>((resolve) => {
		release = resolve;
	});
	let requested = false;
	await context.route('**/api/accounts/*/reveal', async (route) => {
		requested = true;
		await waiting;
		await route.fulfill({ json: { password, version: 2 } }).catch(() => {});
	});
	await page.goto('/accounts');
	await page.getByRole('button', { name: 'Reveal password', exact: true }).click();
	await expect.poll(() => requested).toBe(true);
	await page.evaluate(() => {
		Object.defineProperty(document, 'hidden', { configurable: true, value: true });
		document.dispatchEvent(new Event('visibilitychange'));
	});
	release?.();
	await expect(page.getByRole('button', { name: 'Reveal password', exact: true })).toBeEnabled();
	await expect(page.getByLabel('Revealed password')).toHaveCount(0);
});

test('a long account name wraps within the mobile screen', async ({ page, context }) => {
	await mock(context);
	const name = 'A'.repeat(160);
	await context.route('**/api/accounts', (route) =>
		route.fulfill({ json: { accounts: [{ ...account, name }] } })
	);
	await page.setViewportSize({ width: 320, height: 740 });
	await page.goto('/accounts');
	const heading = page.getByRole('heading', { name, exact: true });
	await expect(heading).toBeVisible();
	await expect.poll(() => heading.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
	await checkScreen(page);
	await page.screenshot({ path: '/tmp/omakase-accounts-long-name-mobile.png' });
});
