import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { axe, horizontalOverflow, smallTargets, stubStream } from './helpers';
async function api(context: BrowserContext) {
	let stores: Record<string, unknown>[] = [];
	await stubStream(context);
	await context.route('**/api/**', async (route) => {
		const req = route.request();
		const path = new URL(req.url()).pathname;
		if (path === '/api/channels') return route.fulfill({ json: { channels: [] } });
		if (path === '/api/me') return route.fulfill({ json: { login: 'owner@example.test' } });
		if (path === '/api/file-stores') {
			if (req.method() === 'GET') return route.fulfill({ json: { stores } });
			const { password, ...fields } = req.postDataJSON();
			const store = {
				...fields,
				id: fields.id ?? '12345678-1234-4234-8234-123456789abc',
				revision: (fields.revision ?? 0) + 1
			};
			stores = [...stores.filter((s) => s.id !== store.id), store];
			return route.fulfill({ json: { store } });
		}
		if (path.endsWith('/test'))
			return route.fulfill({
				status: 502,
				json: {
					error: 'Could not reach the file store. Check Tailscale access rules and NAS firewall.'
				}
			});
		if (path.endsWith('/remove')) {
			stores = [];
			return route.fulfill({ json: { removed: true } });
		}
		return route.fulfill({ status: 404, json: { error: 'Not found' } });
	});
}
async function fill(page: Page) {
	await page.getByRole('button', { name: 'Add file store' }).click();
	await page.getByLabel('Name', { exact: true }).fill('Property documents');
	await page.getByLabel('Server address').fill('https://fileserver:5006');
	await page.getByLabel('Folder 1', { exact: true }).fill('/public/Property');
	await page.getByLabel('NAS account').fill('property-agent');
	await page.getByLabel('Password', { exact: true }).fill('not-a-real-password');
}
test('save, connection failure, edit and remove work on mobile', async ({ page, context }) => {
	await api(context);
	await page.goto('/file-stores');
	await fill(page);
	expect(await horizontalOverflow(page)).toEqual([]);
	expect(await smallTargets(page)).toEqual([]);
	await axe(page);
	await page.getByRole('button', { name: 'Save connection' }).click();
	await expect(page.getByRole('heading', { name: 'Property documents' })).toBeVisible();
	await page.getByRole('button', { name: 'Test connection' }).click();
	await expect(page.getByRole('alert')).toContainText('Tailscale access rules');
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await page.getByRole('button', { name: 'Remove', exact: true }).click();
	await page.getByRole('button', { name: 'Keep connection' }).click();
	await page.getByRole('button', { name: 'Remove', exact: true }).click();
	await page.getByRole('button', { name: 'Remove connection', exact: true }).click();
	await expect(page.getByText('No file stores connected.', { exact: false })).toBeVisible();
});
test('failed saves preserve fields and dirty forms confirm dismissal', async ({
	page,
	context
}) => {
	await api(context);
	await context.route('**/api/file-stores', async (route) =>
		route.request().method() === 'POST'
			? route.fulfill({
					status: 422,
					json: {
						error: 'Check the folder permissions.',
						fields: {
							folders: ['Choose an allowed folder.'],
							certificateSha256: ['Verify the certificate fingerprint.']
						}
					}
				})
			: route.fulfill({ json: { stores: [] } })
	);
	await page.goto('/file-stores');
	await fill(page);
	await page.getByRole('button', { name: 'Save connection' }).click();
	await expect(page.getByRole('alert')).toContainText('folder permissions');
	await expect(page.locator('#store-folders-error')).toBeVisible();
	await expect(page.getByLabel('Folder 1', { exact: true })).toHaveAttribute(
		'aria-errormessage',
		'store-folders-error'
	);
	await expect(page.locator('#store-certificateSha256-error')).toBeVisible();
	await page.getByLabel('Folder 1', { exact: true }).scrollIntoViewIfNeeded();
	await page.screenshot({ path: '/tmp/file-stores-field-error.png', fullPage: true });
	await expect(page.getByLabel('Folder 1', { exact: true })).toHaveValue('/public/Property');
	page.once('dialog', (dialog) => dialog.dismiss());
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(page.getByLabel('Password', { exact: true })).toHaveValue('not-a-real-password');
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(page.getByLabel('Password', { exact: true })).not.toBeVisible();
});
test('narrow dark form supports accessibility and reflow', async ({ page, context }) => {
	await api(context);
	await page.setViewportSize({ width: 320, height: 640 });
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.goto('/file-stores');
	await fill(page);
	await page.getByText('Private certificate', { exact: true }).click();
	expect(await horizontalOverflow(page)).toEqual([]);
	expect(await smallTargets(page)).toEqual([]);
	await axe(page);
});
test('capture file-store screen at mobile and desktop sizes', async ({ page, context }) => {
	await api(context);
	await page.goto('/file-stores');
	await fill(page);
	await page.getByRole('heading', { name: 'Connections' }).scrollIntoViewIfNeeded();
	await page.screenshot({ path: '/tmp/file-stores-mobile.png', fullPage: true });
	await page.getByRole('button', { name: 'Save connection' }).scrollIntoViewIfNeeded();
	await page.screenshot({ path: '/tmp/file-stores-mobile-bottom.png', fullPage: true });
	await page.setViewportSize({ width: 1280, height: 1000 });
	await page.getByRole('heading', { name: 'Connections' }).scrollIntoViewIfNeeded();
	await page.screenshot({ path: '/tmp/file-stores-desktop.png', fullPage: true });
	await page.getByRole('button', { name: 'Save connection' }).scrollIntoViewIfNeeded();
	await page.screenshot({ path: '/tmp/file-stores-desktop-bottom.png', fullPage: true });
	await page.getByRole('button', { name: 'Save connection' }).click();
	await page.getByRole('button', { name: 'Test connection' }).click();
	await expect(page.getByRole('alert')).toContainText('Tailscale access rules');
	await page.getByRole('heading', { name: 'Connections' }).scrollIntoViewIfNeeded();
	await page.screenshot({ path: '/tmp/file-stores-connection-error.png', fullPage: true });
});

test('a NAS connection saves several folders with separate write permissions', async ({
	page,
	context
}) => {
	await api(context);
	await page.goto('/file-stores');
	await fill(page);
	await page.getByRole('button', { name: 'Add folder', exact: true }).click();
	await page.getByLabel('Folder 2', { exact: true }).fill('/public/Reference');
	await page.getByRole('switch', { name: /Allow writes for folder 1/ }).click();
	await page.getByRole('button', { name: 'Save connection' }).click();
	const folderList = page.getByRole('list', { name: 'Allowed folders', exact: true });
	await expect(folderList.getByText('/public/Property', { exact: true })).toBeVisible();
	await expect(folderList.getByText('/public/Reference', { exact: true })).toBeVisible();
	await expect(folderList.getByText('Read and write', { exact: true })).toBeVisible();
	await expect(folderList.getByText('Read only', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await expect(page.getByLabel('Folder 2', { exact: true })).toHaveValue('/public/Reference');
	await page.getByRole('button', { name: 'Remove folder 2', exact: true }).click();
	await page.getByRole('button', { name: 'Save connection' }).click();
	await expect(folderList.getByText('/public/Reference', { exact: true })).not.toBeVisible();
});

test('file stores opens directly from Settings and preserves unsaved edits', async ({
	page,
	context
}) => {
	await api(context);
	await page.goto('/settings');
	await expect(page.getByRole('link', { name: /^File stores/ })).toBeVisible();
	await page.screenshot({ path: '/tmp/file-store-workspace.png', fullPage: true });
	await page.getByRole('link', { name: /^File stores/ }).click();
	await expect(page).toHaveURL(/\/file-stores$/);
	await expect(page.getByRole('heading', { name: 'File stores', level: 1 })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Add file store' }).click();
	await page.getByLabel('Name', { exact: true }).fill('Unsaved store');
	page.once('dialog', (dialog) => dialog.dismiss());
	await page.goBack();
	await expect(page).toHaveURL(/\/file-stores$/);
	page.once('dialog', (dialog) => dialog.accept());
	await page.goBack();
	await expect(page).toHaveURL(/\/settings$/);
	await page.goto('/settings');
	await expect(page.getByRole('button', { name: 'Add file store' })).toHaveCount(0);
});

test('verified certificate hex passes native validation and saves', async ({ page, context }) => {
	await api(context);
	await page.goto('/file-stores');
	await fill(page);
	await page.getByText('Private certificate', { exact: true }).click();
	const fingerprint = page.getByLabel('Verified SHA-256 fingerprint');
	await fingerprint.fill('8e5aefbe171459849e908b8c489b86f9ebfead0661d8e95acaacbf04ea16b50d');
	expect(
		await fingerprint.evaluate((input: HTMLInputElement) => ({
			value: input.value,
			pattern: input.pattern,
			valid: input.checkValidity(),
			message: input.validationMessage
		}))
	).toMatchObject({ valid: true });
	await page.getByRole('button', { name: 'Save connection' }).click();
	await expect(page.getByRole('heading', { name: 'Property documents' })).toBeVisible();
});
