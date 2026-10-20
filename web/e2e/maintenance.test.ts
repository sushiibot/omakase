import { expect, test } from '@playwright/test';
import { fixtureApp, axe, horizontalOverflow } from './helpers';
import type { MaintenanceView } from '../src/lib/features/maintenance';
const id = '00000000-0000-4000-8000-000000000099';
function fixture(): MaintenanceView {
	return {
		responsibility: {
			title: 'Keep upcoming plans accurate',
			enabled: true,
			lastReadAt: '2026-10-16T12:00:00Z',
			lastReviewAt: '2026-10-16T12:00:00Z',
			lastError: null
		},
		proposals: [
			{
				id,
				revision: 1,
				status: 'pending',
				createdAt: '2026-10-16T12:00:00Z',
				updatedAt: '2026-10-16T12:00:00Z',
				expiresAt: '2099-01-01T00:00:00Z',
				eventTitle: 'Friday show at the Civic',
				eventStart: '2026-11-02T20:00:00',
				eventTimeZone: 'America/Los_Angeles',
				emailSubject: 'Your tickets for Friday’s show',
				emailReceivedAt: '2026-10-16T11:00:00Z',
				before: 'Meet Alex outside.',
				after:
					'Meet Alex outside.\n\nDetails from email: Your tickets for Friday’s show\nDoors open at 7 pm. Seat A12.',
				input: {
					reason: 'The show, date, and venue match your existing event.',
					excerpts: ['Doors open at 7 pm. Seat A12.']
				}
			}
		]
	};
}
for (const width of [320, 1440]) {
	test(`calendar maintenance reviews exact notes, keeps native history, and supports Undo at ${width}px`, async ({
		page,
		context
	}) => {
		await fixtureApp(context);
		await page.setViewportSize({ width, height: 915 });
		await context.addInitScript(
			(dark) => localStorage.setItem('theme', dark ? 'dark' : 'light'),
			width === 320
		);
		const view = fixture();
		const actions: unknown[] = [];
		await context.route('**/api/maintenance', async (route) => {
			if (route.request().method() === 'POST') {
				const body = route.request().postDataJSON();
				actions.push(body);
				if (body.action === 'approve') view.proposals[0]!.status = 'completed';
				if (body.action === 'undo') view.proposals[0]!.status = 'undone';
				if (body.action === 'pause') view.responsibility.enabled = !body.paused;
			}
			await route.fulfill({ json: { view } });
		});
		await page.goto('/assistant');
		await expect(page.getByRole('link', { name: 'Ask', exact: true })).toHaveCount(0);
		await page
			.locator('[data-assistant-home]')
			.getByRole('link', { name: /Friday show at the Civic/ })
			.click();
		await expect(page).toHaveURL(new RegExp(`/assistant/updates/${id}$`));
		await expect(page.getByRole('heading', { name: 'Details to add' })).toBeVisible();
		await expect(page.getByText('Doors open at 7 pm. Seat A12.', { exact: true })).toBeVisible();
		await expect(page.getByText('Meet Alex outside.', { exact: true })).toBeVisible();
		expect(actions).toEqual([]);
		await page.screenshot({ path: `/tmp/maintenance-review-${width}.png`, fullPage: true });
		expect(await axe(page)).toEqual([]);
		expect(await horizontalOverflow(page)).toEqual([]);
		await page.reload();
		await expect(page.getByRole('button', { name: 'Update event', exact: true })).toBeEnabled();
		await page.goBack();
		await expect(page).toHaveURL(/\/assistant$/);
		await page.goForward();
		await page.getByRole('button', { name: 'Update event', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Undo update' })).toBeVisible();
		expect(actions).toEqual([{ action: 'approve', id, revision: 1 }]);
		await page.getByRole('button', { name: 'Undo update' }).click();
		await expect(page.getByText('Update undone.', { exact: true })).toBeVisible();
		await page.goBack();
		// A healthy responsibility stays off Home; its page holds the details and Pause.
		await expect(
			page
				.locator('[data-assistant-home]')
				.getByRole('heading', { name: 'Keep upcoming plans accurate' })
		).toHaveCount(0);
		await page.goto('/assistant/watching');
		const watching = page.getByRole('main');
		await expect(
			watching.getByRole('heading', { name: 'Keep upcoming plans accurate' })
		).toBeVisible();
		await watching.getByRole('button', { name: 'Pause', exact: true }).click();
		await expect(watching.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
		await page.screenshot({ path: `/tmp/maintenance-watching-${width}.png`, fullPage: true });
		expect(await axe(page)).toEqual([]);
		expect(await horizontalOverflow(page)).toEqual([]);
	});
}

test('a failed calendar review is one row on Home that opens the responsibility', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	const view = fixture();
	view.proposals = [];
	view.responsibility.lastError = 'Fastmail calendar could not be read.';
	await context.route('**/api/maintenance', (route) => route.fulfill({ json: { view } }));
	await page.goto('/assistant');
	const home = page.locator('[data-assistant-home]');
	const row = home.getByRole('link', { name: /Keep upcoming plans accurate/ });
	await expect(row).toContainText('Last review failed: Fastmail calendar could not be read.');
	await expect(home.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
	await row.click();
	await expect(page).toHaveURL(/\/assistant\/watching$/);
	await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});

test('stale approval shows the server explanation and uncertain writes offer a read-only result check', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	const view = fixture();
	let fail = true;
	await context.route('**/api/maintenance', async (route) => {
		let error: string | undefined;
		if (route.request().method() === 'POST') {
			if (fail) {
				view.proposals[0]!.status = 'conflict';
				error = 'The event changed. Your edits were preserved.';
			} else {
				view.proposals[0]!.status = 'completed';
			}
		}
		await route.fulfill({ json: { view, error } });
	});
	await page.goto(`/assistant/updates/${id}`);
	await page.getByRole('button', { name: 'Update event', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('Your edits were preserved');
	await expect(page.getByRole('button', { name: 'Update event', exact: true })).toHaveCount(0);
	view.proposals[0]!.status = 'uncertain';
	fail = false;
	await page.reload();
	await page.getByRole('button', { name: 'Check result', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Undo update' })).toBeVisible();
});

test('dismissal is a separate decision and paused maintenance prevents approval', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	const view = fixture();
	view.responsibility.enabled = false;
	const actions: unknown[] = [];
	await context.route('**/api/maintenance', async (route) => {
		if (route.request().method() === 'POST') {
			actions.push(route.request().postDataJSON());
			view.proposals[0]!.status = 'dismissed';
		}
		await route.fulfill({ json: { view } });
	});
	await page.goto(`/assistant/updates/${id}`);
	await expect(page.getByRole('button', { name: 'Update event', exact: true })).toBeDisabled();
	await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
	await expect(
		page.getByText('Dismissed. These same additions will not be suggested again.')
	).toBeVisible();
	expect(actions).toEqual([{ action: 'dismiss', id, revision: 1 }]);
});
