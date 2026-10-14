import { expect, test, type BrowserContext } from '@playwright/test';
import { fixtureApp, horizontalOverflow, smallTargets, axe } from './helpers';
import { createFixtureAgentsApi } from '../src/lib/features/agents/fake';

const history = [
	{
		type: 'user',
		id: 'u1',
		at: new Date(Date.now() - 20 * 60_000).toISOString(),
		text: 'Fix the login redirect and bump drizzle.',
		attachments: []
	},
	{
		type: 'assistant',
		id: 'a1',
		at: new Date(Date.now() - 19 * 60_000).toISOString(),
		text: 'I started two coding agents.',
		tools: [
			{ id: 'call-login', name: 'coding_agent', summary: 'action=start', ok: true },
			{ id: 'call-drizzle', name: 'coding_agent', summary: 'action=start', ok: true }
		],
		files: []
	}
];

/** Serves the agent routes from the fixture agents, as the gateway would. */
async function fixtureAgents(context: BrowserContext) {
	const api = createFixtureAgentsApi(() => 'normal');
	await context.route('**/api/agents**', async (route) => {
		const req = route.request();
		const path = new URL(req.url()).pathname.slice('/api/agents'.length);
		const body = req.postData() ? req.postDataJSON() : {};
		try {
			if (!path)
				return route.fulfill({
					json: await api.list(new URL(req.url()).searchParams.get('conversationId') ?? undefined)
				});
			const [id, action] = path.slice(1).split('/');
			if (!action) return route.fulfill({ json: await api.get(id!) });
			if (action === 'answer')
				return route.fulfill({ json: await api.answer(id!, body.requestId, body.decision) });
			if (action === 'message') return route.fulfill({ json: await api.message(id!, body.text) });
			return route.fulfill({ json: await api.stop(id!) });
		} catch (err) {
			return route.fulfill({ status: 409, json: { error: (err as Error).message } });
		}
	});
}

for (const width of [320, 390, 1280]) {
	const phone = width < 1024;
	test(`a notification opens the agent on its approval; answer, message and stop at ${width}px`, async ({
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
		const transcript = () => [
			{
				kind: 'prompt',
				origin: 'agent',
				text: 'Work on the login redirect.',
				at: '2026-10-12T10:00:00Z'
			},
			{ kind: 'command', command: 'rg redirect', exitCode: 0, at: '2026-10-12T10:01:00Z' },
			{
				kind: 'approval',
				requestId: 'approval-1',
				title: 'Run: bun test',
				status: requests.length ? 'pending' : 'accepted',
				at: '2026-10-12T10:02:00Z'
			}
		];
		let release: () => void = () => {};
		const posts: { path: string; body: unknown }[] = [];
		const agent = () => ({
			id: 'a-login',
			machineId: 'pc',
			machineName: 'Desktop',
			rootId: 'code',
			path: 'omakase/web',
			folder: 'Code/omakase/web',
			provider: 'codex',
			title: 'Fix the login redirect',
			conversationId: 'main',
			remoteStatus: status,
			requests: requests.length || undefined,
			requestTitle: requests.length ? 'Run: bun test' : undefined,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		});
		const session = () => ({
			status,
			attempts: 1,
			output: 'raw',
			requests,
			transcript: transcript()
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
		await page.goto('/chat?agent=a-login');
		// Phones open the agent's page over the conversation; the docked panel shows it beside the chat.
		if (phone) await expect(page).toHaveURL(/\/agents\/a-login$/);
		else {
			await expect(page).toHaveURL(/\/chat$/);
			await expect(page.getByRole('tab', { name: /Agents/ })).toHaveAttribute(
				'aria-selected',
				'true'
			);
		}
		const approve = page.getByRole('button', { name: 'Approve', exact: true });
		await expect(page.getByRole('heading', { name: 'Run a command' })).toBeFocused();
		await expect(approve).not.toBeFocused();
		const detail = page.locator('[data-agent-detail="a-login"]');
		await expect(detail.getByText('Needs approval')).toBeVisible();
		await expect(detail.getByText('Codex · Desktop · Code/omakase/web')).toBeVisible();
		await expect(page.getByLabel('Exact input')).toHaveText('bun test');
		await expect(page.getByText('To check the login change')).toBeVisible();
		await expect(detail.getByText('From Sushii')).toBeVisible();
		// No raw log and no attempt counter in the transcript.
		await expect(page.getByText('Attempt 1')).toHaveCount(0);
		const wholeTurn = page.getByRole('switch', {
			name: /Also allow matching requests until this turn ends/
		});
		await expect(wholeTurn).not.toBeChecked();
		await expect(page.getByRole('button', { name: 'Deny' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Cancel request' })).toHaveCount(0);
		// The composer explains why it waits instead of failing a send.
		await expect(page.getByText('Answer the approval first')).toBeVisible();
		await expect.poll(() => horizontalOverflow(page)).toEqual([]);
		await expect.poll(() => smallTargets(page)).toEqual([]);
		expect(await axe(page)).toEqual([]);

		await detail.getByRole('button', { name: 'Agent actions', exact: true }).click();
		const jump = page.getByRole('menuitem', { name: 'Jump to conversation', exact: true });
		await expect(jump).toHaveAttribute('href', /^\/chat/);
		await expect(page.getByRole('menuitem', { name: 'Copy folder path' })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(jump).toHaveCount(0);

		await wholeTurn.click();
		await approve.click();
		await expect(page.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
		release();
		await expect(page.getByRole('heading', { name: 'Run a command' })).toHaveCount(0);
		const box = page.getByRole('textbox', { name: 'Message Fix the login redirect' });
		await expect(box).toHaveAttribute('placeholder', /Codex reads it during this turn/);
		await box.fill('Include a summary');
		await page.getByRole('button', { name: 'Send to agent' }).click();
		await expect.poll(() => posts.length).toBe(2);
		await expect(box).toHaveValue('');
		await page.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect.poll(() => posts.length).toBe(3);
		expect(posts).toEqual([
			{
				path: '/api/agents/a-login/answer',
				body: { requestId: 'approval-1', decision: 'acceptForSession' }
			},
			{ path: '/api/agents/a-login/message', body: { text: 'Include a summary' } },
			{ path: '/api/agents/a-login/stop', body: {} }
		]);
		await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
		await expect(box).toBeFocused();

		if (phone) {
			// Back returns to the conversation the notification named, with no panel left open.
			await page.getByRole('button', { name: 'Back to conversation' }).click();
			await expect(page).toHaveURL(/\/chat$/);
			await expect(page.getByRole('tab', { name: /Agents/ })).not.toBeVisible();
		}
	});
}

for (const width of [390, 1280]) {
	const phone = width < 1024;
	test(`agents live in the side panel and as cards under the message that started them at ${width}px`, async ({
		page,
		context
	}) => {
		await page.setViewportSize({ width, height: 915 });
		await fixtureApp(context, { history });
		await fixtureAgents(context);
		await page.goto('/chat');
		const cards = page.getByRole('list', { name: 'Coding agents started here' });
		await expect(cards.getByRole('link')).toHaveCount(2);
		await expect(cards.getByRole('link').first()).toContainText('Fix the login redirect');
		await expect(cards.getByRole('link').first()).toContainText('Needs approval');
		await expect(cards.getByRole('link').nth(1)).toContainText('Failed');
		// The header button keeps its name and gains a dot; the badge counts requests, not agents.
		const panelButton = page.getByRole('button', {
			name: /^Tasks, .*Agents: 1 request needs you/
		});
		await expect(panelButton).toBeVisible();
		await panelButton.click();
		const agentsTab = page.getByRole('tab', { name: /Agents/ });
		await expect(agentsTab).toHaveAttribute('aria-selected', 'true');
		await expect(agentsTab).toContainText('1');
		const list = page.locator('[data-agent-list]');
		await expect(list.getByRole('heading', { level: 2 })).toHaveText([
			/Needs you\s*2/,
			/Working\s*1/,
			/Finished\s*3/
		]);
		await expect(list.locator('[data-agent-row]')).toHaveCount(6);
		await expect(list.locator('[data-agent-row="a-sheet"]')).toContainText('Unverified');
		await expect(list.locator('[data-agent-row="a-sheet"]')).toContainText('New result');
		await expect.poll(() => horizontalOverflow(page)).toEqual([]);
		await expect.poll(() => smallTargets(page)).toEqual([]);
		expect(await axe(page)).toEqual([]);

		// A machine without transcripts shows its raw output as one Activity block.
		await list.locator('[data-agent-row="a-notes"]').click();
		if (phone) await expect(page).toHaveURL(/\/agents\/a-notes$/);
		await expect(page.getByLabel('Raw output')).toContainText('cat docs/deploy.md');
		await page
			.getByRole('button', { name: phone ? 'Back to conversation' : 'Back to agents' })
			.click();
		if (phone) await expect(page).toHaveURL(/\/chat$/);
		// A card in the chat opens the same detail: a page on phones, the panel beside the chat on desktop.
		await cards.getByRole('link').nth(1).click();
		if (phone) await expect(page).toHaveURL(/\/agents\/a-drizzle$/);
		const detail = page.locator('[data-agent-detail="a-drizzle"]');
		await expect(detail).toBeVisible();
		await expect(detail.getByText('From Sushii')).toBeVisible();
		const work = detail.getByRole('button', {
			name: /^Turn 1 work: Worked .* 2 commands · 1 failed/
		});
		// A turn with a failure stays open, so the failure is visible without a tap.
		await expect(work).toHaveAttribute('aria-expanded', 'true');
		await expect(detail.getByText('exit 2')).toBeVisible();
		await work.click();
		await expect(work).toHaveAttribute('aria-expanded', 'false');
		await expect(detail.getByText('Failed: bunx tsc --noEmit exited with 2')).toBeVisible();
		await expect.poll(() => horizontalOverflow(page)).toEqual([]);
		await expect.poll(() => smallTargets(page)).toEqual([]);
		expect(await axe(page)).toEqual([]);
	});
}

test('a request id a later turn reuses shows one live card, in that turn; the earlier turn stays answered', async ({
	page,
	context
}) => {
	await page.setViewportSize({ width: 390, height: 640 });
	await fixtureApp(context);
	const request = {
		id: 'req-1',
		description: 'Run: bun test',
		decisions: ['accept', 'decline'],
		detail: { kind: 'command', command: 'bun test' }
	};
	const at = (m: number) => new Date(Date.parse('2026-10-12T10:00:00Z') + m * 60_000).toISOString();
	const long = Array.from({ length: 30 }, (_, i) => `Line ${i} of a long answer.`).join('\n\n');
	const transcript = [
		{ kind: 'prompt', origin: 'agent', text: 'First turn', at: at(0) },
		{ kind: 'approval', requestId: 'req-1', title: 'Run: ls', status: 'accepted', at: at(1) },
		{ kind: 'message', text: long, final: true, at: at(2) },
		{ kind: 'turnEnd', status: 'completed', at: at(3) },
		{ kind: 'prompt', origin: 'owner', text: 'Second turn', at: at(4) },
		{ kind: 'approval', requestId: 'req-1', title: 'Run: bun test', status: 'pending', at: at(5) }
	];
	const agent = {
		id: 'a-reuse',
		machineId: 'pc',
		machineName: 'Desktop',
		rootId: 'code',
		folder: 'Code',
		provider: 'codex',
		title: 'Reused ids',
		conversationId: 'main',
		remoteStatus: 'needs-you',
		requests: 1,
		createdAt: at(0),
		updatedAt: at(5)
	};
	await context.route('**/api/agents**', (route) =>
		route.fulfill({
			json:
				new URL(route.request().url()).pathname === '/api/agents'
					? { agents: [agent] }
					: {
							agent,
							session: {
								status: 'needs-you',
								attempts: 2,
								output: '',
								requests: [request],
								transcript
							}
						}
		})
	);
	await page.goto('/agents/a-reuse');
	const detail = page.locator('[data-agent-detail="a-reuse"]');
	const heading = detail.getByRole('heading', { name: 'Run a command' });
	await expect(heading).toHaveCount(1);
	await expect(heading).toBeFocused();
	// The live card follows the second prompt, not the first.
	const order = await detail.evaluate((root) => {
		const prompt = [...root.querySelectorAll('[data-prompt]')].at(-1)!;
		const card = root.querySelector('[data-approval]')!;
		return !!(prompt.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING);
	});
	expect(order).toBe(true);
	const first = detail.getByRole('button', { name: /^Turn 1 work:/ });
	await first.click();
	await expect(detail.getByText('Approved')).toBeVisible();
	await expect(detail.getByText('Run: ls')).toBeVisible();
	// Scrolled away from the card, the pointer brings it back without its own decision controls.
	await detail.locator('[data-agent-scroll]').evaluate((el) => (el.scrollTop = 0));
	const review = page.getByRole('button', { name: /1 approval pending · Review/ });
	await expect(review).toBeVisible();
	await review.click();
	await expect(heading).toBeFocused();
	await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(1);
});
