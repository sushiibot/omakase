import { expect, test } from '@playwright/test';
import { axe, fixtureApp, horizontalOverflow, smallTargets } from './helpers';

test('tasks live beside chat; mobile back restores the main draft', async ({ page, context }) => {
	await fixtureApp(context);
	await page.goto('/chat');
	const composer = page.getByRole('textbox', { name: 'Message', exact: true });
	await composer.fill('Keep this main draft');
	await page.getByRole('button', { name: 'Tasks, 3 open' }).click();
	const panel = page.getByRole('complementary', { name: 'Conversation tasks' });
	await expect(panel).toBeVisible();
	await expect(panel).toContainText('Fix login redirect');
	await expect(panel).not.toContainText('Check train options');
	await expect(page.locator('[data-chat-surface] > .chat-content')).toHaveAttribute(
		'aria-hidden',
		'true'
	);
	await expect(panel).toHaveAttribute('data-workspace-inspector', '');
	const panelBox = await panel.boundingBox();
	expect(panelBox?.width).toBeLessThanOrEqual(360);
	const returnTarget = page.getByRole('button', { name: 'Return to conversation', exact: true });
	expect((await returnTarget.boundingBox())?.width).toBeGreaterThanOrEqual(48);
	await expect(page.locator('[data-delegated-agents]')).toHaveCount(0);
	await page.goBack();
	await expect(composer).toBeVisible();
	await expect(composer).toHaveValue('Keep this main draft');
	await page.getByRole('button', { name: 'Tasks, 3 open' }).click();
	await panel.getByRole('button', { name: /Fix login redirect/ }).click();
	await expect(panel.getByRole('checkbox', { name: 'Test expired sessions' })).not.toBeChecked();
	await panel.getByRole('checkbox', { name: 'Test expired sessions' }).check();
	await expect(panel.getByRole('checkbox', { name: 'Test expired sessions' })).toBeChecked();
	await panel.getByRole('button', { name: 'Edit details', exact: true }).click();
	await panel
		.getByRole('textbox', { name: 'Brief', exact: true })
		.fill('Verify sign-in and expired sessions.');
	await panel.getByRole('button', { name: 'Save changes', exact: true }).click();
	await expect(panel).toContainText('Verify sign-in and expired sessions.');
	await panel.getByRole('textbox', { name: 'New checklist step' }).fill('Review session recovery');
	await panel.getByRole('button', { name: 'Add checklist step', exact: true }).click();
	await expect(panel.getByRole('checkbox', { name: 'Review session recovery' })).not.toBeChecked();
	await expect(panel.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0);
	await expect(panel.getByRole('button', { name: 'Send message', exact: true })).toHaveCount(0);
	await expect(panel.getByRole('link', { name: 'Jump to conversation' })).toHaveAttribute(
		'href',
		'/tasks/t-login?view=conversation'
	);
	await panel.getByRole('button', { name: 'Results', exact: true }).click();
	await expect(panel.getByRole('heading', { name: 'Latest result' })).toBeVisible();
	await panel.getByRole('button', { name: 'Activity', exact: true }).click();
	await expect(panel.locator('a[href="/runs/01K6B2N8W3J5Q7R9T1V3X5Z7A9"]')).toHaveAttribute(
		'href',
		'/runs/01K6B2N8W3J5Q7R9T1V3X5Z7A9'
	);
	await panel.getByRole('button', { name: 'Details', exact: true }).click();
	await expect.poll(() => horizontalOverflow(page)).toEqual([]);
	await expect.poll(() => smallTargets(page)).toEqual([]);
	expect(await axe(page)).toEqual([]);
});
test('the task list saves a to-do without starting work and keeps its checklist', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await page.goto('/tasks');
	await page.getByRole('textbox', { name: 'New task' }).fill('Renew passport');
	await page.getByRole('button', { name: 'Add task', exact: true }).click();
	await page.getByRole('button', { name: 'Renew passport', exact: true }).click();
	await expect(page).toHaveURL(/\/tasks\/t-/);
	await page
		.getByRole('textbox', { name: 'Brief', exact: true })
		.fill('Check the renewal requirements.');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await page.getByRole('textbox', { name: 'New checklist step' }).fill('Find appointment times');
	await page.getByRole('button', { name: 'Add checklist step' }).click();
	await expect(page.getByRole('checkbox', { name: 'Find appointment times' })).not.toBeChecked();
	await page.getByRole('button', { name: 'Conversation', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Start with Sushii' })).toBeVisible();
	await page.getByRole('button', { name: 'Overview', exact: true }).click();
	await page.getByRole('button', { name: 'Mark done', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Reopen task' })).toBeVisible();
});
test('topic task panels scope assignments, and desktop keeps chat visible', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await page.goto('/chats/oct-trip');
	await page.getByRole('button', { name: 'Tasks, 1 open' }).click();
	const panel = page.getByRole('complementary', { name: 'Conversation tasks' });
	await expect(panel.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0);
	await expect(panel).toContainText('Check train options');
	await expect(panel).not.toContainText('Fix login redirect');
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
	await expect(panel).toBeVisible();
});
test('task prompts use their task channel and preserve the main composer draft', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	const sends: string[] = [];
	await context.route('**/api/tasks/*/chat/messages', async (route) => {
		sends.push(route.request().url());
		return route.fulfill({ status: 202, json: { seq: 1, routed: true } });
	});
	await page.goto('/chat');
	await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Main draft');
	await page.getByRole('button', { name: 'Tasks, 3 open' }).click();
	const panel = page.getByRole('complementary', { name: 'Conversation tasks' });
	await panel.getByRole('button', { name: /Fix login redirect/ }).click();
	await expect(panel.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0);
	await panel.getByRole('link', { name: 'Jump to conversation' }).click();
	await expect(page).toHaveURL(/\/tasks\/t-login\?view=conversation$/);
	await page
		.getByRole('textbox', { name: 'Message', exact: true })
		.fill('Also test expired sessions');
	await page.getByRole('button', { name: 'Send message', exact: true }).click();
	await expect.poll(() => sends.length).toBe(1);
	expect(sends[0]).toContain('/api/tasks/t-login/chat/messages');
	await page.goBack();
	await expect(page).toHaveURL(/\/chat$/);
	if (await panel.isVisible())
		await panel.getByRole('button', { name: 'Close tasks', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
		'Main draft'
	);
});
for (const width of [320, 412])
	for (const theme of ['light', 'dark'] as const)
		test(`tasks reflow and accessibility ${width} ${theme}`, async ({ page, context }) => {
			await fixtureApp(context);
			await page.setViewportSize({ width, height: 915 });
			await page.emulateMedia({ colorScheme: theme });
			await page.goto('/tasks');
			await page.getByRole('button', { name: /Fix login redirect/ }).click();
			await expect(page.getByRole('heading', { name: /Checklist/ })).toBeVisible();
			expect(
				await page
					.locator('input[type="text"],input:not([type]),textarea')
					.evaluateAll((els) => els.every((el) => parseFloat(getComputedStyle(el).fontSize) >= 16))
			).toBe(true);
			await expect.poll(() => horizontalOverflow(page)).toEqual([]);
			await expect.poll(() => smallTargets(page)).toEqual([]);
			expect(await axe(page)).toEqual([]);
		});

test('starting saves the visible brief, and a failed save never starts work', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await page.goto('/tasks');
	await page.getByRole('button', { name: 'Book a dentist appointment', exact: true }).click();
	await page
		.getByRole('textbox', { name: 'Brief', exact: true })
		.fill('Find an appointment after 3pm.');
	let starts = 0;
	await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
	await context.route('**/api/tasks', async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		const action = route.request().postDataJSON();
		if (action.action === 'start') starts++;
		if (action.action === 'update')
			return route.fulfill({ status: 409, json: { error: 'This task changed.' } });
		return route.fallback();
	});
	await page.getByRole('button', { name: 'Ask Sushii to work on this', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('Your draft is kept');
	await expect(page.getByRole('textbox', { name: 'Brief', exact: true })).toHaveValue(
		'Find an appointment after 3pm.'
	);
	expect(starts).toBe(0);
});

for (const destination of ['/tasks', '/chat']) {
	test(`completed tasks stay hidden, viewable and recoverable in ${destination}`, async ({
		page,
		context
	}) => {
		await fixtureApp(context);
		await page.goto(destination);
		if (destination === '/chat') await page.getByRole('button', { name: 'Tasks, 3 open' }).click();
		const list = page.locator('[data-task-list]');
		const title = 'Book a dentist appointment';
		await list.getByRole('checkbox', { name: `Mark ${title} done`, exact: true }).click();
		const done = list.getByRole('button', { name: /^Done \d+$/ });
		await expect(done).toHaveAttribute('aria-expanded', 'false');
		await expect(list.getByRole('button', { name: title, exact: true })).toBeHidden();
		await page.reload();
		if (destination === '/chat') await page.getByRole('button', { name: 'Tasks, 2 open' }).click();
		await expect(done).toHaveAttribute('aria-expanded', 'false');
		await done.click();
		await expect(
			list.getByRole('checkbox', { name: `Mark ${title} to do`, exact: true })
		).toBeChecked();
		await expect(list.getByRole('button', { name: title, exact: true })).toBeVisible();
		await expect.poll(() => horizontalOverflow(page)).toEqual([]);
		await expect.poll(() => smallTargets(page)).toEqual([]);
		expect(await axe(page)).toEqual([]);
		await list.getByRole('checkbox', { name: `Mark ${title} to do`, exact: true }).click();
		await expect(
			list
				.getByRole('region', { name: 'To do', exact: true })
				.getByRole('button', { name: title, exact: true })
		).toBeVisible();
		await page.reload();
		if (destination === '/chat') await page.getByRole('button', { name: 'Tasks, 3 open' }).click();
		await expect(
			list.getByRole('checkbox', { name: `Mark ${title} done`, exact: true })
		).not.toBeChecked();
	});
}
