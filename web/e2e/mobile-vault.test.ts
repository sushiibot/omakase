import { expect, test } from '@playwright/test';
import { stubStream, horizontalOverflow, smallTargets } from './helpers';

test('Android vault connects, handles one file call and disconnects', async ({ page, context }) => {
	await stubStream(context);
	await page.addInitScript(() => {
		let selected = false;
		const status = () => ({
			version: 1,
			id: 'phone-11111111-1111-4111-8111-111111111111',
			connected: selected,
			...(selected ? { name: 'My notes' } : {})
		});
		Object.assign(window, {
			androidBridge: {},
			Capacitor: {
				PluginHeaders: [
					{
						name: 'ObsidianVault',
						methods: ['status', 'choose', 'disconnect', 'execute'].map((name) => ({
							name,
							rtype: 'promise'
						}))
					}
				],
				nativePromise: async (_plugin: string, method: string) => {
					if (method === 'choose') selected = true;
					if (method === 'disconnect') selected = false;
					if (method === 'execute') return { content: '# My note', hash: 'a'.repeat(64) };
					return status();
				}
			}
		});
	});
	const results: unknown[] = [];
	let polled = false;
	let disconnects = 0;
	await context.route('**/api/**', async (route) => {
		const path = new URL(route.request().url()).pathname;
		const json = (data: unknown) =>
			route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
		if (path.endsWith('/phone/connect'))
			return json({ session: '11111111-1111-4111-8111-111111111111' });
		if (path.endsWith('/phone/poll')) {
			if (!polled) {
				polled = true;
				return json({
					requests: [{ id: 'read-1', params: { action: 'read', path: 'Note.md', rootId: 'vault' } }]
				});
			}
			await new Promise((resolve) => setTimeout(resolve, 1000));
			return json({ requests: [] });
		}
		if (path.endsWith('/phone/result')) {
			results.push(route.request().postDataJSON());
			return json({ ok: true });
		}
		if (path.endsWith('/phone/disconnect')) {
			disconnects++;
			return json({ ok: true });
		}
		if (path === '/api/me') return json({ login: 'owner@example.com' });
		if (path === '/api/settings/owner-name') return json({ name: null });
		if (path === '/api/push/key') return route.fulfill({ status: 404 });
		if (path === '/api/channels') return json({ channels: [] });
		if (path === '/api/threads' || path === '/api/chats') return json({ threads: [] });
		if (path.endsWith('/history')) return json({ items: [], before: null });
		return json({});
	});
	await page.goto('/settings');
	await expect(page.getByRole('button', { name: 'Connect vault', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Connect vault', exact: true }).click();
	await expect(page.getByText('My notes', { exact: true })).toBeVisible();
	await expect(page.getByText('Ready for the agent', { exact: false })).toBeVisible();
	await expect.poll(() => results.length).toBe(1);
	expect(results[0]).toMatchObject({ id: 'read-1', result: { content: '# My note' } });
	expect(await horizontalOverflow(page)).toEqual([]);
	expect(await smallTargets(page)).toEqual([]);
	await page.screenshot({ path: test.info().outputPath('vault-phone.png') });
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.screenshot({ path: test.info().outputPath('vault-desktop.png') });
	await page.getByRole('button', { name: 'Disconnect vault', exact: true }).click();
	await expect(page.getByText('No folder connected')).toBeVisible();
	await expect.poll(() => disconnects).toBeGreaterThan(0);
});

test('browser settings do not offer native vault access', async ({ page, context }) => {
	await stubStream(context);
	await context.route('**/api/**', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({ threads: [], channels: [] })
		})
	);
	await page.goto('/settings');
	await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Connect vault', exact: true })).toHaveCount(0);
});
