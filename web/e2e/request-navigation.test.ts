import { expect, test } from '@playwright/test';
import { fixtureApp, push } from './helpers';

// Request links (?ask=, ?approve=, ?turn=) load the page around their item, as message links do
// (docs/message-links.md); message-links.test.ts covers ?m=.

const latest = Array.from({ length: 40 }, (_, i) => ({
	type: 'assistant',
	id: `${100 + i}`,
	at: 'x',
	text: `Recent message ${i}. This conversation continued after the older owner question.`,
	tools: [],
	files: []
}));
const request = {
	type: 'ask',
	id: '7',
	at: 'x',
	askId: 'older-decision',
	question: 'Which deployment window?',
	choices: ['Friday afternoon', 'Monday morning']
};

test('a linked older question loads the page around it, focuses it and preserves later reading position', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	const around: string[] = [];
	await context.route('**/api/chat/history?*', async (route) => {
		const q = new URL(route.request().url()).searchParams;
		if (q.has('around')) {
			around.push(q.get('around')!);
			return route.fulfill({
				json: { items: [request, ...latest.slice(0, 3)], before: null, after: '102', target: '7' }
			});
		}
		return route.fulfill({ json: { items: latest, before: '100' } });
	});
	await page.goto('/chat?ask=older-decision');
	const answer = page.getByRole('button', { name: 'Friday afternoon', exact: true });
	// The question takes focus, never a choice a held Enter could pick.
	await expect(page.locator('[data-ask-id="older-decision"]')).toBeFocused();
	await expect(answer).toBeInViewport();
	expect(around).toEqual(['older-decision']);
	await expect(page.locator('[data-link-status]')).toHaveCount(0);
	const scroller = page.locator('main');
	await scroller.evaluate((el) => el.scrollBy({ top: 160, behavior: 'instant' }));
	const before = await answer.evaluate((el) => el.getBoundingClientRect().top);
	await push(
		page,
		'reply',
		{
			key: 'later-reply',
			text: 'Another update after the owner moved their reading position.',
			files: []
		},
		81
	);
	await page.waitForTimeout(200);
	expect(
		Math.abs((await answer.evaluate((el) => el.getBoundingClientRect().top)) - before)
	).toBeLessThanOrEqual(1);
	expect(around).toHaveLength(1);
});

test('an unavailable request says so and leaves the conversation usable', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await context.route('**/api/chat/history?*', async (route) => {
		const q = new URL(route.request().url()).searchParams;
		return route.fulfill({
			json: q.has('around')
				? { items: latest, before: '100', after: null, target: null, missing: true }
				: { items: latest, before: '100' }
		});
	});
	await page.goto('/chat?ask=missing-decision');
	await expect(page.locator('[data-link-status]')).toContainText(
		'That message is no longer available.'
	);
	await page.getByRole('textbox', { name: 'Message', exact: true }).fill('My draft is safe');
	await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
		'My draft is safe'
	);
});

test('a failed request load can retry and reveal the linked question', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	let attempts = 0;
	await context.route('**/api/chat/history?*', async (route) => {
		if (!new URL(route.request().url()).searchParams.has('around'))
			return route.fulfill({ json: { items: latest, before: '100' } });
		if (++attempts === 1)
			return route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } });
		return route.fulfill({
			json: { items: [request], before: null, after: '7', target: '7' }
		});
	});
	await page.goto('/chat?ask=older-decision');
	await expect(page.locator('[data-link-status]')).toContainText(
		"Couldn't load the linked message"
	);
	await page
		.locator('[data-link-status]')
		.getByRole('button', { name: 'Retry', exact: true })
		.click();
	await expect(page.locator('[data-ask-id="older-decision"]')).toBeFocused();
	expect(attempts).toBe(2);
});

test('a linked question focuses when the live stream hydrates it after empty history', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await context.route('**/api/chat/history?*', async (route) => {
		const q = new URL(route.request().url()).searchParams;
		return route.fulfill({
			json: q.has('around')
				? { items: [], before: null, after: null, target: null, missing: true }
				: { items: [], before: null }
		});
	});
	await page.goto('/chat?ask=delayed-decision');
	await expect(page.locator('[data-link-status]')).toContainText('no longer available');
	await push(
		page,
		'ask',
		{
			key: 'delayed-question',
			askId: 'delayed-decision',
			question: 'Which window works?',
			choices: ['This evening', 'Tomorrow']
		},
		1
	);
	await expect(page.locator('[data-ask-id="delayed-decision"]')).toBeFocused();
	await expect(page.locator('[data-link-status]')).toHaveCount(0);
});

test('a conversation jump loads an older reply and focuses it without sending a prompt', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	const around: string[] = [];
	await context.route('**/api/chat/history?*', (route) => {
		const q = new URL(route.request().url()).searchParams;
		if (q.has('around')) {
			around.push(q.get('around')!);
			return route.fulfill({
				json: {
					items: [
						{
							...latest[0],
							id: '5',
							turnId: 'origin-turn',
							text: 'The linked execution started here.'
						}
					],
					before: null,
					after: '5',
					target: '5'
				}
			});
		}
		return route.fulfill({ json: { items: latest, before: '100' } });
	});
	await page.goto('/chat?turn=origin-turn');
	const reply = page.locator('[data-turn-id="origin-turn"]');
	await expect(reply).toBeFocused();
	await expect(reply).toBeInViewport();
	await expect(page.locator('[data-link-status]')).toHaveCount(0);
	expect(around).toEqual(['origin-turn']);
	await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Continue this work');
	await expect(reply).toBeInViewport();
	await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
		'Continue this work'
	);
});

test('a missing linked turn leaves the conversation usable and says what happened', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await context.route('**/api/chat/history?*', (route) => {
		const q = new URL(route.request().url()).searchParams;
		return route.fulfill({
			json: q.has('around')
				? { items: latest, before: null, after: null, target: null, missing: true }
				: { items: latest, before: null }
		});
	});
	await page.goto('/chat?turn=missing-turn');
	await expect(page.locator('[data-link-status]')).toContainText(
		'That message is no longer available.'
	);
	await page.getByRole('textbox', { name: 'Message', exact: true }).fill('My draft');
	await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('My draft');
});

for (const [path, history] of [
	['/chats/oct-trip', '/api/threads/oct-trip/chat/history'],
	['/tasks/t-login?view=conversation', '/api/tasks/t-login/chat/history']
]) {
	test(`conversation jumps focus the originating turn in ${path}`, async ({ page, context }) => {
		await fixtureApp(context);
		await context.route(`**${history}*`, (route) =>
			route.fulfill({
				json: {
					items: [
						{
							...latest[0],
							id: '5',
							turnId: 'origin-turn',
							text: 'The linked work happened here.'
						}
					],
					before: null,
					after: null,
					target: '5'
				}
			})
		);
		await page.goto(`${path}${path.includes('?') ? '&' : '?'}turn=origin-turn`);
		const reply = page.locator('[data-turn-id="origin-turn"]');
		await expect(reply).toBeFocused();
		await expect(reply).toBeInViewport();
	});
}
