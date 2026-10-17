import { expect, test } from '@playwright/test';
import { stubStream, horizontalOverflow, axe } from './helpers';

const clientId = '01J9Z3W8K2M4N6P8Q0R2S4T6V8';
for (const width of [320, 412, 1280]) {
	test(`edit and delete sent history at ${width}px`, async ({ page, context }) => {
		await page.setViewportSize({ width, height: 915 });
		await page.emulateMedia({ colorScheme: width === 412 ? 'dark' : 'light' });
		await stubStream(context);
		let history = [
			{
				type: 'user',
				id: '1',
				clientId,
				at: '2026-10-17T12:00:00Z',
				text: 'Original question',
				attachments: []
			},
			{
				type: 'assistant',
				id: '2',
				at: '2026-10-17T12:01:00Z',
				text: 'Old answer',
				tools: [],
				files: []
			}
		];
		const requests: unknown[] = [];
		let refuse = true;
		await context.route('**/api/**', async (route) => {
			const path = new URL(route.request().url()).pathname;
			const json = (data: unknown, status = 200) =>
				route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
			if (path.endsWith('/history')) return json({ items: history, before: null });
			if (path.endsWith('/rewind')) {
				const body = route.request().postDataJSON();
				requests.push(body);
				if (refuse)
					return json({ error: 'Stop the conversation’s work before changing its history.' }, 409);
				history = body.replacement
					? [{ ...history[0]!, text: body.replacement.text, clientId: body.replacement.clientId }]
					: [];
				return json({ ok: true });
			}
			if (path.endsWith('/seen')) return route.fulfill({ status: 204 });
			return json({}, 404);
		});
		await page.goto('/chat');
		await expect(page.getByText('Original question', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Edit and resend', exact: true }).click();
		const editor = page.getByRole('textbox', { name: 'Edit message', exact: true });
		await expect(editor).toBeFocused();
		await editor.fill('Revised question');
		await page.getByRole('button', { name: 'Save and resend' }).click();
		await expect(page.getByRole('alert')).toContainText('Stop the conversation');
		await expect(editor).toHaveValue('Revised question');
		refuse = false;
		expect(await horizontalOverflow(page)).toEqual([]);
		expect(await axe(page)).toEqual([]);
		await page.screenshot({ path: `/tmp/rewind-editor-${width}.png`, fullPage: true });
		await page.getByRole('button', { name: 'Save and resend' }).click();
		await expect(page.getByText('Revised question', { exact: true })).toBeVisible();
		await expect(page.getByText('Old answer', { exact: true })).toHaveCount(0);
		await page.getByRole('button', { name: 'Delete from here', exact: true }).click();
		await page.getByRole('button', { name: 'Cancel', exact: true }).click();
		expect(requests).toHaveLength(2);
		await page.getByRole('button', { name: 'Delete from here', exact: true }).click();
		await page
			.getByRole('form', { name: 'Change conversation history' })
			.getByRole('button', { name: 'Delete from here', exact: true })
			.click();
		await expect(page.getByText('Revised question', { exact: true })).toHaveCount(0);
		expect(requests.at(-1)).toEqual({});
	});
}

test('a rewind received over SSE and HTTP resets history only once', async () => {
	const { createState, applyEvent, mergeHistory } = await import('../src/lib/features/chat/reduce');
	const state = createState();
	mergeHistory(state, [
		{ type: 'user', id: '1', clientId, at: 'now', text: 'old', attachments: [] }
	]);
	const effects = applyEvent(state, { type: 'rewind', seq: 2, data: { clientId } });
	expect(effects).toContainEqual({ type: 'reload' });
	expect(state.items).toHaveLength(0);
	expect(applyEvent(state, { type: 'rewind', data: { clientId } })).toEqual([]);
	expect(state.cursor).toBe(2);
});
