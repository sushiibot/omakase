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
		let requests = [
			{
				id: 'approval-1',
				description: 'Run tests\n$ bun test\nWorking folder: /projects/sushii',
				decisions: ['accept', 'acceptForSession', 'decline', 'cancel']
			}
		];
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
					status = 'running';
					requests = [];
				} else if (path.endsWith('/stop')) status = 'stopped';
				return route.fulfill({ json: { agent: agent(), session: session() } });
			}
			if (path === '/api/agents') return route.fulfill({ json: { agents: [agent()] } });
			return route.fulfill({ json: { agent: agent(), session: session() } });
		});
		await page.goto('/chat');
		const row = page.getByRole('button', { name: /Codex agent on Desktop/ });
		await expect(row).toContainText('Needs approval');
		await row.click();
		const approve = page.getByRole('button', { name: 'Approve', exact: true });
		await expect(approve).toBeVisible();
		await expect(page.getByLabel('Agent output')).toContainText('Inspecting the login redirect');
		await expect(page.getByRole('button', { name: 'Approve for this session' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Deny' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Cancel request' })).toHaveCount(0);
		await page.screenshot({
			path: `../.impeccable/review/agents-${width === 320 ? 'mobile' : 'desktop'}.png`
		});
		if (width === 320) expect((await approve.boundingBox())!.y).toBeGreaterThan(610);
		await approve.click();
		await expect(page.getByText('Codex takes this message during its current turn.')).toBeVisible();
		await page.getByRole('textbox', { name: 'Message this agent' }).fill('Include a summary');
		await page.getByRole('button', { name: 'Send to agent' }).click();
		await expect.poll(() => posts.length).toBe(2);
		await page.getByRole('button', { name: 'Stop agent' }).click();
		await expect.poll(() => posts.length).toBe(3);
		expect(posts).toEqual([
			{ path: '/api/agents/a-login/answer', body: { requestId: 'approval-1', decision: 'accept' } },
			{ path: '/api/agents/a-login/message', body: { text: 'Include a summary' } },
			{ path: '/api/agents/a-login/stop', body: {} }
		]);
		await expect.poll(() => horizontalOverflow(page)).toEqual([]);
		await expect.poll(() => smallTargets(page)).toEqual([]);
		expect(await axe(page)).toEqual([]);
	});
}
