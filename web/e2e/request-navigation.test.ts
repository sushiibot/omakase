import { expect, test } from '@playwright/test';
import { fixtureApp, push } from './helpers';

const latest = Array.from({ length: 40 }, (_, i) => ({
	type: 'assistant',
	id: `recent-${i}`,
	at: 'x',
	text: `Recent message ${i}. This conversation continued after the older owner question.`,
	tools: [],
	files: []
}));
const request = {
	type: 'ask',
	id: 'old-question',
	at: 'x',
	askId: 'older-decision',
	question: 'Which deployment window?',
	choices: ['Friday afternoon', 'Monday morning']
};

test('a linked older question loads its history page, focuses it and preserves later reading position', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	let olderRequests = 0;
	await context.route('**/api/chat/history?*', async (route) => {
		if (new URL(route.request().url()).searchParams.has('before')) {
			olderRequests++;
			return route.fulfill({ json: { items: [request], before: null } });
		}
		return route.fulfill({ json: { items: latest, before: 'older-page' } });
	});
	await page.goto('/chat?ask=older-decision');
	const answer = page.getByRole('button', { name: 'Friday afternoon', exact: true });
	// The question takes focus, never a choice a held Enter could pick.
	await expect(page.locator('[data-ask-id="older-decision"]')).toBeFocused();
	await expect(answer).toBeInViewport();
	expect(olderRequests).toBe(1);
	await expect(page.locator('[data-request-search]')).toHaveCount(0);
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
	await expect(
		page.getByText('Another update after the owner moved their reading position.')
	).toBeAttached();
	expect(
		Math.abs((await answer.evaluate((el) => el.getBoundingClientRect().top)) - before)
	).toBeLessThanOrEqual(1);
	expect(olderRequests).toBe(1);
});

test('an unavailable request stops when an older page makes no progress and offers bounded recovery', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	let olderRequests = 0;
	await context.route('**/api/chat/history?*', async (route) => {
		const older = new URL(route.request().url()).searchParams.has('before');
		if (older) olderRequests++;
		return route.fulfill({ json: { items: latest, before: 'unchanged-page' } });
	});
	await page.goto('/chat?ask=missing-decision');
	await expect(page.locator('[data-request-search]')).toContainText(
		'farther back, or is no longer available'
	);
	expect(olderRequests).toBe(1);
	await page.getByRole('textbox', { name: 'Message', exact: true }).fill('My draft is safe');
	await page.getByRole('button', { name: 'Keep looking', exact: true }).click();
	await expect.poll(() => olderRequests).toBe(2);
	await expect(page.locator('[data-request-search]')).toContainText(
		'farther back, or is no longer available'
	);
	await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
		'My draft is safe'
	);
});

test('a failed older request can retry and reveal the linked question', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	let attempts = 0;
	await context.route('**/api/chat/history?*', async (route) => {
		if (!new URL(route.request().url()).searchParams.has('before'))
			return route.fulfill({ json: { items: latest, before: 'older-page' } });
		if (++attempts === 1)
			return route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } });
		return route.fulfill({ json: { items: [request], before: null } });
	});
	await page.goto('/chat?ask=older-decision');
	await expect(page.locator('[data-request-search]')).toContainText(
		"Couldn't load the linked request"
	);
	await page
		.locator('[data-request-search]')
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
	let olderRequests = 0;
	await context.route('**/api/chat/history?*', async (route) => {
		if (new URL(route.request().url()).searchParams.has('before')) olderRequests++;
		return route.fulfill({ json: { items: [], before: null } });
	});
	await page.goto('/chat?ask=delayed-decision');
	await expect(page.locator('[data-request-search]')).toContainText(
		'no longer in this conversation'
	);
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
	await expect(page.locator('[data-request-search]')).toHaveCount(0);
	expect(olderRequests).toBe(0);
});

test('a conversation jump loads an older reply and focuses it without sending a prompt', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	let olderRequests = 0;
	await context.route('**/api/chat/history?*', (route) => {
		if (new URL(route.request().url()).searchParams.has('before')) {
			olderRequests++;
			return route.fulfill({
				json: {
					items: [
						{
							...latest[0],
							id: 'old-reply',
							turnId: 'origin-turn',
							text: 'The linked execution started here.'
						}
					],
					before: null
				}
			});
		}
		return route.fulfill({ json: { items: latest, before: 'older-page' } });
	});
	await page.goto('/chat?turn=origin-turn');
	const reply = page.locator('[data-turn-id="origin-turn"]');
	await expect(reply).toBeFocused();
	await expect(reply).toBeInViewport();
	await expect(page.locator('[data-request-search]')).toHaveCount(0);
	expect(olderRequests).toBe(1);
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
	await context.route('**/api/chat/history?*', (route) =>
		route.fulfill({ json: { items: latest, before: null } })
	);
	await page.goto('/chat?turn=missing-turn');
	await expect(page.locator('[data-request-search]')).toContainText(
		'The linked reply is no longer in this conversation.'
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
							id: 'origin-reply',
							turnId: 'origin-turn',
							text: 'The linked work happened here.'
						}
					],
					before: null
				}
			})
		);
		await page.goto(`${path}${path.includes('?') ? '&' : '?'}turn=origin-turn`);
		const reply = page.locator('[data-turn-id="origin-turn"]');
		await expect(reply).toBeFocused();
		await expect(reply).toBeInViewport();
	});
}
