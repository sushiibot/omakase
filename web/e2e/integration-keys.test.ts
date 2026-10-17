import { expect, test } from '@playwright/test';
import { fixtureApp } from './helpers';

for (const desktop of [false, true]) {
	test(`guided credential setup, ${desktop ? 'desktop' : 'phone'}`, async ({ page, context }) => {
		if (desktop) await page.setViewportSize({ width: 1280, height: 900 });
		await fixtureApp(context);
		let configured = false;
		const values: string[] = [];
		await context.route('**/api/integrations**', async (route) => {
			const req = route.request();
			if (req.method() === 'PUT') {
				values.push(req.postDataJSON().key);
				configured = true;
			}
			if (req.method() === 'DELETE') configured = false;
			await route.fulfill({
				json: {
					integrations: [
						{
							id: 'google_maps',
							name: 'Google Maps',
							capability: 'Search places and addresses with Places API (New)',
							configured,
							setupUrl: '/connectors/keys',
							links: [
								{
									label: 'Set up Google Maps',
									url: 'https://developers.google.com/maps/documentation/places/web-service/get-api-key'
								},
								{
									label: 'Key restrictions',
									url: 'https://developers.google.com/maps/api-security-best-practices'
								},
								{
									label: 'Open Google Cloud credentials',
									url: 'https://console.cloud.google.com/apis/credentials'
								}
							],
							steps: [
								'Choose a Google Cloud project, enable billing, and enable Places API (New).',
								"Create an API key. Restrict it to Places API (New) and your gateway's public outgoing IP address.",
								'Paste the key below. Save and test makes one Places request, which may incur a Google charge.'
							]
						}
					]
				}
			});
		});
		await page.goto('/connectors');
		await page.getByRole('link', { name: 'API keys', exact: true }).click();
		await expect(page.getByText('Setup needed', { exact: true })).toBeVisible();
		const input = page.getByLabel('API key', { exact: true });
		await expect(input).toHaveAttribute('type', 'password');
		await input.fill('test-key-never-in-chat-123456');
		await page.screenshot({
			path: `/tmp/omakase-integrations-${desktop ? 'desktop' : 'phone'}.png`,
			fullPage: true
		});
		await page.getByRole('button', { name: 'Save and test' }).click();
		await expect(page.getByText('Key saved on server', { exact: true })).toBeVisible();
		expect(values).toEqual(['test-key-never-in-chat-123456']);
		await expect(page.getByLabel('Replacement API key', { exact: true })).toHaveValue('');
		expect(
			await page.evaluate(
				() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
			)
		).not.toContain(values[0]);
		await page.getByRole('button', { name: 'Remove key', exact: true }).click();
		await page.getByRole('button', { name: 'Confirm removal' }).click();
		await expect(page.getByText('Setup needed', { exact: true })).toBeVisible();
	});
}

test('failed key test clears input and preserves configured status', async ({ page, context }) => {
	await fixtureApp(context);
	await context.route('**/api/integrations**', (route) =>
		route.fulfill(
			route.request().method() === 'PUT'
				? { status: 400, json: { error: 'Google Maps rejected the request. Check the key.' } }
				: {
						json: {
							integrations: [
								{
									id: 'google_maps',
									name: 'Google Maps',
									capability: 'Search places',
									configured: true,
									setupUrl: '/connectors/keys',
									links: [],
									steps: []
								}
							]
						}
					}
		)
	);
	await page.goto('/connectors/keys');
	await page.getByLabel('Replacement API key').fill('test-key-never-in-chat-123456');
	await page.getByRole('button', { name: 'Save and test' }).click();
	await expect(page.getByRole('alert')).toContainText('Google Maps rejected');
	await expect(page.getByLabel('Replacement API key')).toHaveValue('');
	await expect(page.getByText('Key saved on server', { exact: true })).toBeVisible();
});
