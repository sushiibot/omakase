import { expect, test } from '@playwright/test';
import { fixtureApp, axe, horizontalOverflow, smallTargets } from './helpers';

const labels = [
	'Preferences',
	'Website accounts',
	'Mail accounts',
	'API integrations',
	'MCP servers',
	'File stores',
	'Tool permissions'
];
for (const colorScheme of ['light', 'dark'] as const) {
	test(`flat settings work on mobile and desktop in ${colorScheme}`, async ({ page, context }) => {
		await fixtureApp(context);
		await context.route('**/api/tool-policy', (route) =>
			route.fulfill({ json: { rules: 'Ask before changing connected services.' } })
		);
		await page.emulateMedia({ colorScheme });
		await page.goto('/settings');
		await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
		const directory = page.locator('main').getByRole('navigation', { name: 'Settings sections' });
		for (const label of labels)
			await expect(directory.getByRole('link', { name: new RegExp(`^${label}`) })).toBeVisible();
		await expect(
			page.locator('main').getByRole('link', { name: /^Connectors|^Agent settings/ })
		).toHaveCount(0);
		expect(await axe(page)).toEqual([]);
		expect(await smallTargets(page)).toEqual([]);
		for (const width of [320, 412]) {
			await page.setViewportSize({ width, height: 915 });
			expect(await horizontalOverflow(page)).toEqual([]);
		}
		await page.screenshot({
			path: `/tmp/omakase-settings-${colorScheme}-mobile.png`,
			fullPage: true
		});
		await directory.getByRole('searchbox', { name: 'Search settings' }).fill('password');
		await expect(directory.getByRole('link')).toHaveCount(1);
		await expect(directory.getByRole('link')).toContainText('Website accounts');
		await directory.getByRole('searchbox').fill('nothing matches');
		await expect(directory.getByRole('status')).toContainText('No settings match');
		await directory.getByRole('searchbox').fill('');
		await directory.getByRole('link', { name: /^Tool permissions/ }).click();
		await expect(page).toHaveURL(/\/settings\/permissions$/);
		await page.getByRole('link', { name: 'Settings', exact: true }).click();
		await expect(page).toHaveURL(/\/settings$/);
		await page.setViewportSize({ width: 1280, height: 900 });
		await expect(page).toHaveURL(/\/settings\/preferences$/);
		await expect(page.getByRole('heading', { name: 'Preferences', exact: true })).toBeVisible();
		const sidebar = page.getByRole('navigation', { name: 'Settings navigation', exact: true });
		for (const label of labels)
			await expect(sidebar.getByRole('link', { name: label, exact: true })).toBeVisible();
		await sidebar.getByRole('link', { name: 'Tool permissions', exact: true }).click();
		await expect(
			sidebar.getByRole('link', { name: 'Tool permissions', exact: true })
		).toHaveAttribute('aria-current', 'page');
		await expect(sidebar.getByRole('link', { name: 'Back to app' })).toBeVisible();
		expect(await axe(page)).toEqual([]);
		expect(await horizontalOverflow(page)).toEqual([]);
		await page.screenshot({
			path: `/tmp/omakase-settings-${colorScheme}-desktop.png`,
			fullPage: true
		});
		await sidebar.getByRole('link', { name: 'Back to app' }).click();
		await expect(page).toHaveURL(/\/chat$/);
		await expect(
			page.getByRole('navigation', { name: 'Channel navigation', exact: true })
		).toBeVisible();
	});
}
test('old menu URLs lead to the flat settings directory', async ({ page, context }) => {
	await fixtureApp(context);
	for (const path of ['/connectors', '/workspace/agent-settings']) {
		await page.goto(path);
		await expect(page).toHaveURL(/\/settings$/);
		await expect(
			page.locator('main').getByRole('link', { name: /^Website accounts/ })
		).toBeVisible();
	}
});

test.describe('desktop keyboard navigation', () => {
	test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
	test('desktop preferences preserve edits on resize and search supports keyboard navigation', async ({
		page,
		context
	}) => {
		await fixtureApp(context);
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await context.route('**/api/settings/owner-name', (route) =>
			route.fulfill({ json: { name: 'Sam' } })
		);
		await page.goto('/settings');
		await expect(page).toHaveURL(/\/settings\/preferences$/);
		await page.getByRole('button', { name: 'Edit your name' }).click();
		await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Unfinished edit');
		await page.setViewportSize({ width: 412, height: 915 });
		await expect(page.getByRole('textbox', { name: 'Your name', exact: true })).toHaveValue(
			'Unfinished edit'
		);
		await page.setViewportSize({ width: 1280, height: 900 });
		const sidebar = page.getByRole('navigation', { name: 'Settings navigation', exact: true });
		await sidebar.getByRole('searchbox').fill('password');
		await page.keyboard.press('Tab');
		const account = sidebar.getByRole('link', { name: 'Website accounts', exact: true });
		await expect(account).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/\/accounts$/);
		await expect(account).toHaveAttribute('aria-current', 'page');
	});
});

test('the mobile directory reflows with enlarged text', async ({ page, context }) => {
	await fixtureApp(context);
	await page.setViewportSize({ width: 320, height: 915 });
	await page.goto('/settings');
	await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
	await page.evaluate(() => {
		document.documentElement.style.fontSize = '200%';
	});
	expect(await horizontalOverflow(page)).toEqual([]);
});
