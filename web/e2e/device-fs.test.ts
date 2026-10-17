import { expect, test } from '@playwright/test';
import { stubStream, horizontalOverflow, smallTargets } from './helpers';

test('Android folders connect independently and retain the remaining grant', async ({
	page,
	context
}) => {
	await stubStream(context);
	await page.addInitScript(() => {
		let folders: { id: string; name: string; available: boolean }[] = [];
		let choices = 0;
		const status = () => ({
			version: 4,
			id: 'phone-11111111-1111-4111-8111-111111111111',
			connected: folders.length > 0,
			folders
		});
		Object.assign(window, {
			androidBridge: {},
			Capacitor: {
				PluginHeaders: [
					{
						name: 'DeviceFs',
						methods: ['status', 'choose', 'disconnect', 'execute'].map((name) => ({
							name,
							rtype: 'promise'
						}))
					}
				],
				nativePromise: async (_plugin: string, method: string, params?: { rootId: string }) => {
					if (method === 'choose') {
						choices++;
						folders.push({
							id: choices === 1 ? 'vault' : 'folder-22222222-2222-4222-8222-222222222222',
							name: choices === 1 ? 'My files' : 'Projects',
							available: true
						});
					}
					if (method === 'disconnect') folders = folders.filter((f) => f.id !== params?.rootId);
					if (method === 'execute') return { content: '{"enabled":true}', hash: 'a'.repeat(64) };
					return status();
				}
			}
		});
	});
	const results: unknown[] = [];
	let polled = false;
	let disconnects = 0;
	const connections: { roots: { id: string; name: string }[] }[] = [];
	await context.route('**/api/**', async (route) => {
		const path = new URL(route.request().url()).pathname;
		const json = (data: unknown) =>
			route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
		if (path.endsWith('/phone/connect')) {
			connections.push(route.request().postDataJSON());
			return json({ session: '11111111-1111-4111-8111-111111111111' });
		}
		if (path.endsWith('/phone/poll')) {
			if (!polled) {
				polled = true;
				return json({
					requests: [
						{ id: 'read-1', params: { action: 'read', path: 'settings.json', rootId: 'vault' } }
					]
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
	await expect(page.getByRole('button', { name: 'Add folder', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Add folder', exact: true }).click();
	await expect(page.getByText('My files', { exact: true })).toBeVisible();
	await expect(page.getByText('Not set up in the Android app', { exact: true })).toBeVisible();
	await expect(page.getByRole('switch', { name: 'Notify this device' })).toBeDisabled();
	await expect(page.getByText('Ready for the agent', { exact: false })).toBeVisible();
	await expect.poll(() => results.length).toBe(1);
	expect(results[0]).toMatchObject({ id: 'read-1', result: { content: '{"enabled":true}' } });
	await page.getByRole('button', { name: 'Add folder', exact: true }).click();
	await expect(page.getByText('Projects', { exact: true })).toBeVisible();
	await expect.poll(() => connections.at(-1)?.roots.length).toBe(2);
	expect(connections.at(-1)?.roots.map((r) => r.name)).toEqual(['My files', 'Projects']);
	expect(await horizontalOverflow(page)).toEqual([]);
	expect(await smallTargets(page)).toEqual([]);
	await page.screenshot({ path: test.info().outputPath('vault-phone.png') });
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.screenshot({ path: test.info().outputPath('vault-desktop.png') });
	await page.getByRole('button', { name: 'Disconnect My files', exact: true }).click();
	await expect(page.getByText('My files', { exact: true })).toHaveCount(0);
	await expect(page.getByText('Projects', { exact: true })).toBeVisible();
	await expect.poll(() => connections.at(-1)?.roots.map((r) => r.name)).toEqual(['Projects']);
	await page.getByRole('button', { name: 'Disconnect Projects', exact: true }).click();
	await expect(page.getByText('No folders connected')).toBeVisible();
	await expect.poll(() => disconnects).toBeGreaterThan(0);
});

test('browser settings do not offer native folder access', async ({ page, context }) => {
	await stubStream(context);
	await context.route('**/api/**', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({ threads: [], channels: [] })
		})
	);
	await page.goto('/settings');
	await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add folder', exact: true })).toHaveCount(0);
});
