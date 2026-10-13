import { expect, test } from '@playwright/test';
import { fixtureApp, horizontalOverflow, smallTargets, axe } from './helpers';

for (const width of [320, 1280]) {
	test(`a coding agent's approval, message and stop in its conversation at ${width}px`, async ({
		page,
		context
	}) => {
		await page.setViewportSize({ width, height: 915 });
		await fixtureApp(context);
		let status = 'needs-you';
		let requests: unknown[] = [
			{
				id: 'approval-1',
				description: 'Run: bun test',
				decisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
				detail: {
					kind: 'command',
					command: 'bun test',
					cwd: '/projects/sushii',
					reason: 'To check the login change'
				}
			}
		];
		let release: () => void = () => {};
		const posts: { path: string; body: unknown }[] = [];
		const agent = () => ({
			id: 'a-login',
			machineId: 'pc',
			machineName: 'Desktop',
			rootId: 'code',
			provider: 'codex',
			title: 'Fix the login redirect',
			conversationId: 'main',
			remoteStatus: status,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		});
		const session = () => ({
			status,
			attempts: 1,
			output: 'Inspecting the login redirect and test coverage.',
			requests
		});
		await context.route('**/api/agents**', async (route) => {
			const path = new URL(route.request().url()).pathname;
			if (route.request().method() === 'POST') {
				const body = route.request().postDataJSON();
				posts.push({ path, body });
				if (path.endsWith('/answer')) {
					// Held until the test sees the in-flight state.
					await new Promise<void>((resolve) => (release = resolve));
					status = 'running';
					requests = [];
				} else if (path.endsWith('/stop')) status = 'stopped';
				return route.fulfill({ json: { agent: agent(), session: session() } });
			}
			if (path === '/api/agents') return route.fulfill({ json: { agents: [agent()] } });
			return route.fulfill({ json: { agent: agent(), session: session() } });
		});
		// A notification link opens the agent with its approval in view.
		await page.goto('/chat?agent=a-login');
		const approve = page.getByRole('button', { name: 'Approve', exact: true });
		await expect(approve).toBeFocused();
		await expect(page.getByRole('button', { name: /Codex agent on Desktop/ })).toContainText(
			'Needs approval'
		);
		await expect(page.getByLabel('Agent output')).toContainText('Inspecting the login redirect');
		await expect(page.getByLabel('Exact input')).toHaveText('bun test');
		await expect(page.getByText("Agent's explanation: To check the login change")).toBeVisible();
		const wholeTurn = page.getByRole('switch', {
			name: 'Also allow matching requests until this turn ends'
		});
		await expect(wholeTurn).not.toBeChecked();
		await expect(page.getByRole('button', { name: 'Deny' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Cancel request' })).toHaveCount(0);
		await page.screenshot({
			path: `../.impeccable/review/agents-${width === 320 ? 'mobile' : 'desktop'}.png`
		});
		if (width === 320) expect((await approve.boundingBox())!.y).toBeGreaterThan(610);
		await wholeTurn.click();
		await approve.click();
		await expect(page.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
		release();
		await expect(page.getByText('Codex takes this message during its current turn.')).toBeVisible();
		await page.getByRole('textbox', { name: 'Message this agent' }).fill('Include a summary');
		await page.getByRole('button', { name: 'Send to agent' }).click();
		await expect.poll(() => posts.length).toBe(2);
		await page.getByRole('button', { name: 'Stop agent' }).click();
		await expect.poll(() => posts.length).toBe(3);
		expect(posts).toEqual([
			{
				path: '/api/agents/a-login/answer',
				body: { requestId: 'approval-1', decision: 'acceptForSession' }
			},
			{ path: '/api/agents/a-login/message', body: { text: 'Include a summary' } },
			{ path: '/api/agents/a-login/stop', body: {} }
		]);
		await expect.poll(() => horizontalOverflow(page)).toEqual([]);
		await expect.poll(() => smallTargets(page)).toEqual([]);
		expect(await axe(page)).toEqual([]);
	});
}
