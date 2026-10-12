import { expect, test } from '@playwright/test';
import { fixtureApp, horizontalOverflow, smallTargets, axe } from './helpers';
import { taskFixtures } from '../src/lib/features/tasks/fixtures';

for (const width of [320, 1280]) {
	test(`remote task selection, approval, follow-up and stop at ${width}px`, async ({
		page,
		context
	}) => {
		await page.setViewportSize({ width, height: 915 });
		await fixtureApp(context);
		let task = structuredClone(taskFixtures[0]!);
		task.status = 'todo';
		let status = 'completed';
		let requests: { id: string; description: string }[] = [];
		const actions: unknown[] = [];
		await context.route('**/api/tasks', async (route) => {
			if (route.request().method() === 'POST') {
				const body = route.request().postDataJSON();
				actions.push(body);
				if (body.action === 'start') {
					task.execution ??= {
						machineId: 'pc',
						rootId: 'code',
						provider: 'codex',
						sessionId: 's-login'
					};
					if (!body.text) {
						status = 'needs-you';
						requests = [
							{
								id: 'approval-1',
								description: 'Run tests\n$ bun test\nWorking folder: /projects/sushii'
							}
						];
					} else {
						status = 'running';
						requests = [];
					}
					task.status = 'in-progress';
					task.revision++;
				} else if (body.action === 'stop') {
					status = 'stopped';
					task.status = 'todo';
					task.revision++;
				}
			}
			await route.fulfill({ json: { tasks: [task] } });
		});
		await context.route('**/api/machines', (route) =>
			route.fulfill({
				json: {
					machines: [
						{
							id: 'pc',
							name: 'My PC',
							connected: true,
							roots: [{ id: 'code', name: 'Code', coding: true }],
							providers: ['codex']
						}
					]
				}
			})
		);
		await context.route('**/api/machines/tasks/*', (route) =>
			route.fulfill({
				json: {
					session: {
						status,
						output: 'Inspecting the login redirect and test coverage.',
						attempts: 1,
						requests
					}
				}
			})
		);
		await context.route('**/api/machines/tasks/*/answer', async (route) => {
			if (route.request().postDataJSON().decision === 'accept') {
				status = 'completed';
				requests = [];
			}
			await route.fulfill({
				json: { session: { status, output: 'All checks passed.', attempts: 1, requests } }
			});
		});
		await page.goto('/tasks/t-login');
		await page.getByLabel('Machine and folder').selectOption('pc/code/codex');
		expect(actions).toEqual([]);
		await page.getByRole('button', { name: 'Start on selected machine' }).click();
		await expect
			.poll(() => actions[0])
			.toEqual({
				action: 'start',
				id: 't-login',
				target: { machineId: 'pc', rootId: 'code', provider: 'codex' }
			});
		await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
		await expect(page.getByRole('region', { name: 'Remote work' })).toContainText('$ bun test');
		if (width === 320)
			expect(
				(await page.getByRole('button', { name: 'Approve', exact: true }).boundingBox())!.y
			).toBeGreaterThan(610);
		await page.screenshot({
			path: `../.impeccable/review/machines-${width === 320 ? 'mobile' : 'desktop'}.png`
		});
		await page.getByRole('button', { name: 'Approve', exact: true }).click();
		await expect(page.getByLabel('Remote session output')).toContainText('All checks passed.');
		await page.getByRole('textbox', { name: 'Follow up' }).fill('Also check expired sessions');
		await page.getByRole('button', { name: 'Send to Codex' }).click();
		await expect(page.getByRole('button', { name: 'Stop remote work' })).toBeVisible();
		await page.getByRole('button', { name: 'Stop remote work' }).click();
		expect(actions).toContainEqual({
			action: 'start',
			id: 't-login',
			text: 'Also check expired sessions'
		});
		await expect.poll(() => actions).toContainEqual({ action: 'stop', id: 't-login' });
		await expect.poll(() => horizontalOverflow(page)).toEqual([]);
		await expect.poll(() => smallTargets(page)).toEqual([]);
		expect(await axe(page)).toEqual([]);
	});
}

test('machine discovery failure is distinct from an empty configuration and can be retried', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	let failed = true;
	await context.route('**/api/machines', (route) =>
		route.fulfill(
			failed
				? { status: 503, json: { error: 'Machine discovery unavailable.' } }
				: { json: { machines: [] } }
		)
	);
	await page.goto('/tasks/t-login');
	await expect(page.getByRole('button', { name: 'Retry machine connection' })).toBeVisible();
	await page.screenshot({ path: '../.impeccable/review/machines-discovery-error.png' });
	failed = false;
	await page.getByRole('button', { name: 'Retry machine connection' }).click();
	await expect(page.getByRole('region', { name: 'Remote work' })).toContainText(
		'No machines are configured.'
	);
	await expect(page.getByRole('link', { name: 'Set up a machine' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Retry machine connection' })).toHaveCount(0);
});
