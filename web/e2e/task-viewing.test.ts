import { expect, test } from '@playwright/test';
import { fixtureApp, push, streamRequests } from './helpers';

test('task read receipts require the visible Conversation tab and uncovered workspace content', async ({
	page,
	context
}) => {
	await fixtureApp(context, { streams: ['/api/chat/stream', '/api/tasks/t-login/chat/stream'] });
	const seen: number[] = [];
	await context.route('**/api/tasks/t-login/chat/seen', async (route) => {
		seen.push(route.request().postDataJSON().seq);
		return route.fulfill({ status: 204 });
	});
	await page.goto('/tasks/t-login');
	await expect(page.getByRole('textbox', { name: 'Brief', exact: true })).toBeVisible();
	await expect
		.poll(async () =>
			(await streamRequests(page)).some((url) => url.includes('/tasks/t-login/chat/stream'))
		)
		.toBe(true);
	await push(
		page,
		'proactive',
		{ key: 'task-hidden', text: 'Task update while Overview is open', files: [] },
		1
	);
	await page.waitForTimeout(1200);
	expect(seen).toEqual([]);
	await page.getByRole('tab', { name: 'Conversation', exact: true }).click();
	await expect(page.getByText('Task update while Overview is open', { exact: true })).toBeVisible();
	await expect.poll(() => seen).toEqual([1]);
	await page.getByRole('tab', { name: 'Overview', exact: true }).click();
	await push(
		page,
		'proactive',
		{ key: 'task-hidden-again', text: 'Task update after returning to Overview', files: [] },
		2
	);
	await page.waitForTimeout(1200);
	expect(seen).toEqual([1]);
	await page.getByRole('tab', { name: 'Conversation', exact: true }).click();
	await expect.poll(() => seen).toEqual([1, 2]);
	await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this task draft');
	await page.getByRole('button', { name: /^Menu/ }).click();
	await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible();
	await push(
		page,
		'proactive',
		{ key: 'task-covered', text: 'Task update behind channel navigation', files: [] },
		3
	);
	await page.waitForTimeout(1200);
	expect(seen).toEqual([1, 2]);
	await page.getByRole('button', { name: 'Return to conversation', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
		'Keep this task draft'
	);
	await expect.poll(() => seen).toEqual([1, 2, 3]);
});
