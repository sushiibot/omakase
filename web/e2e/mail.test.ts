import { expect, test } from '@playwright/test';
import { checkScreen, fixtureApp } from './helpers';
const account = {
	id: '11111111-1111-4111-8111-111111111111',
	provider: 'fastmail',
	email: 'property@example.com',
	name: 'Oak Street',
	purpose: 'Maintenance and tenants',
	status: 'connected'
};
const providers = [
	{
		id: 'gmail',
		name: 'Google Gmail',
		connectLabel: 'Continue with Google',
		auth: 'oauth',
		configured: true
	},
	{ id: 'fastmail', name: 'Fastmail', auth: 'token', configured: true }
];
async function mailFixture(context: Parameters<typeof fixtureApp>[0]) {
	await fixtureApp(context);
	let accounts = [account];
	let rules = '';
	const writes: unknown[] = [];
	await context.route('**/api/tool-policy', async (route) => {
		if (route.request().method() === 'POST') rules = route.request().postDataJSON().rules;
		await route.fulfill({ json: { rules } });
	});
	await context.route('**/api/mail**', async (route) => {
		const path = new URL(route.request().url()).pathname;
		const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined;
		if (body) writes.push(body);
		if (path.endsWith('/remove')) {
			accounts = [];
			await route.fulfill({ json: { message: 'Account disconnected.' } });
		} else if (path.endsWith('/rename')) {
			accounts = [{ ...account, ...body }];
			await route.fulfill({ json: { account: accounts[0] } });
		} else if (path.endsWith('/token')) {
			accounts = [
				...accounts,
				{ ...account, id: '22222222-2222-4222-8222-222222222222', name: body.name }
			];
			await route.fulfill({ json: { account: accounts.at(-1) } });
		} else await route.fulfill({ json: { accounts, providers } });
	});
	return { writes, rules: () => rules };
}
test('mail accounts can be added, renamed and disconnected; secrets are cleared', async ({
	page,
	context
}) => {
	const app = await mailFixture(context);
	await page.goto('/connectors');
	await page.getByRole('link', { name: 'Accounts & rules' }).click();
	await expect(page.getByText('property@example.com', { exact: false })).toBeVisible();
	await page.getByLabel('Provider', { exact: true }).selectOption('fastmail');
	await page.getByLabel('Account name', { exact: true }).fill('Maple Avenue');
	await page.getByLabel('API token', { exact: true }).fill('private-test-token');
	await page.getByRole('button', { name: 'Connect account', exact: true }).click();
	await expect(page.getByRole('status')).toContainText('Mail account connected');
	await expect(page.getByLabel('API token', { exact: true })).toHaveValue('');
	expect(app.writes).toContainEqual({
		name: 'Maple Avenue',
		purpose: '',
		token: 'private-test-token'
	});
	await page.getByRole('button', { name: 'Edit details', exact: true }).first().click();
	await page.getByLabel('Account name', { exact: true }).fill('Oak Street rentals');
	await page.getByRole('button', { name: 'Save details', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Oak Street rentals' })).toBeVisible();
	await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
	await page.getByRole('button', { name: 'Disconnect account', exact: true }).click();
	await expect(page.getByText('No mail accounts connected yet.')).toBeVisible();
});
test('owner rules can be changed independently of provider accounts', async ({ page, context }) => {
	const app = await mailFixture(context);
	await page.goto('/connectors/mail');
	await page.getByRole('button', { name: 'Draft-only preset' }).click();
	await page.getByRole('button', { name: 'Save rules' }).click();
	await expect(page.getByRole('status')).toContainText('Tool-use rules saved');
	expect(app.rules()).toContain('Do not send');
	await page.reload();
	await expect(page.getByLabel('Additional restrictions')).toHaveValue(app.rules());
});
for (const colorScheme of ['light', 'dark'] as const) {
	test(`mail account setup passes accessibility and reflow in ${colorScheme}`, async ({
		page,
		context
	}) => {
		await page.emulateMedia({ colorScheme });
		await mailFixture(context);
		await page.goto('/connectors/mail');
		await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
		await checkScreen(page);
		await page.getByLabel('Provider', { exact: true }).selectOption('fastmail');
		await checkScreen(page);
	});
}
test('mail load failure has retry and no editable stale policy', async ({ page, context }) => {
	await mailFixture(context);
	await context.route('**/api/mail', (route) =>
		route.fulfill({ status: 503, json: { error: 'Mail is unavailable.' } })
	);
	await page.goto('/connectors/mail');
	await expect(page.getByRole('alert')).toContainText('Mail is unavailable');
	await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Save rules' })).toHaveCount(0);
});
