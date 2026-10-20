import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { fakeBackend, type Scenario } from './fake-backend';
import { channelFixture } from '../src/lib/features/channels/fixtures';
import { HEARTBEAT_ITEMS_KEY, RUN_IDS } from '../src/lib/features/home/fixtures';
import {
	expandConversationInboxes,
	axe,
	horizontalOverflow,
	push,
	smallTargets,
	stubStream,
	openDrawer
} from './helpers';

type Call = { method: string; path: string; body: unknown };

const approval = (nonce: string, tool = 'send_email') => ({
	seq: 3,
	at: new Date(Date.now() - 3 * 60_000).toISOString(),
	nonce,
	view: {
		tool,
		agentId: 'main',
		agentName: 'sushii-agent',
		fields: [{ key: 'to', value: 'sam@example.com', kind: 'single', max: 200 }]
	}
});
const ask = (askId: string) => ({
	seq: 4,
	at: new Date(Date.now() - 10 * 60_000).toISOString(),
	key: `o-${askId}`,
	askId,
	question: 'Which day works for the car service?',
	choices: ['Friday', 'Saturday']
});

/** The app on fixtures: Home's server part from the fake backend, the stream and chat mocked here. */
async function homeServer(
	context: BrowserContext,
	opts: {
		pending?: { approvals: unknown[]; asks: unknown[] };
		fixtures?: Scenario;
		streamStatus?: number;
		decide?: number;
	} = {}
) {
	await expandConversationInboxes(context);
	const calls: Call[] = [];
	let pendingApprovals = (opts.pending?.approvals ?? []) as ReturnType<typeof approval>[];
	const pendingAsks = (opts.pending?.asks ?? []) as ReturnType<typeof ask>[];
	const resolveApproval = (nonce: string) => {
		pendingApprovals = pendingApprovals.filter((item) => item.nonce !== nonce);
	};
	// Main's log: what was posted, with the item each one answers as the bot would record it.
	const posted: {
		type: 'user';
		id: string;
		clientId: string;
		at: string;
		text: string;
		attachments: [];
		ref?: unknown;
	}[] = [];
	await stubStream(context);
	await context.addInitScript(
		({ pending, streamStatus }) => {
			const w = window as unknown as {
				__sse: { hello: { pending: unknown }; status: number };
			};
			if (pending) w.__sse.hello.pending = pending;
			if (streamStatus) w.__sse.status = streamStatus;
		},
		{ pending: opts.pending, streamStatus: opts.streamStatus }
	);
	await context.route('**/api/**', async (route) => {
		const req = route.request();
		const url = new URL(req.url());
		const raw = req.postData();
		calls.push({ method: req.method(), path: url.pathname, body: raw ? JSON.parse(raw) : null });
		const json = (data: unknown, status = 200) =>
			route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
		if (url.pathname === '/api/channels') {
			const approvals = pendingApprovals;
			const asks = pendingAsks;
			const total = approvals.length + asks.length;
			return json({
				archiveAfterDays: 7,
				channels: [
					channelFixture('main', 'Main', {
						state: total ? 'needs-you' : 'idle',
						pending: { asks: asks.length, approvals: approvals.length, total },
						attention: [
							...asks.map((item) => ({
								kind: 'ask' as const,
								id: item.askId,
								seq: item.seq,
								at: item.at
							})),
							...approvals.map((item) => ({
								kind: 'approval' as const,
								id: item.nonce,
								seq: item.seq,
								at: item.at
							}))
						]
					})
				]
			});
		}
		if (url.pathname === '/api/chat/history') return json({ items: posted, before: null });
		if (url.pathname === '/api/chat/messages') {
			const body = JSON.parse(raw!) as {
				clientId: string;
				text: string;
				ref?: { id: string; item?: string };
			};
			const at = new Date().toISOString();
			posted.push({
				type: 'user',
				id: String(posted.length + 1),
				clientId: body.clientId,
				at,
				text: body.text,
				attachments: [],
				...(body.ref
					? {
							ref: {
								id: body.ref.id,
								job: 'heartbeat',
								at,
								excerpt: 'From the fixture.',
								...(body.ref.item
									? {
											item: {
												key: body.ref.item,
												title:
													body.ref.item === 'lucid:mutants:main'
														? 'lucid mutation tests failing'
														: body.ref.item
											}
										}
									: {})
							}
						}
					: {})
			});
			return json({ seq: posted.length, routed: true }, 202);
		}
		if (url.pathname.startsWith('/api/chat/approvals/')) {
			if (opts.decide && opts.decide !== 200) return json({ error: 'x' }, opts.decide);
			resolveApproval(decodeURIComponent(url.pathname.split('/').at(-1)!));
			return json({ status: 'decided' });
		}
		if (url.pathname.startsWith('/api/chat/asks/')) return json({ status: 'answered' });
		if (url.pathname === '/api/chat/seen') return route.fulfill({ status: 204 });
		return route.fulfill({ status: 404, body: 'Not found' });
	});
	const backend = await fakeBackend(context, { home: opts.fixtures });
	const posts = (prefix: string) =>
		[...calls, ...backend.calls].filter((c) => c.method === 'POST' && c.path.startsWith(prefix));
	return { calls, posts, backend, resolveApproval };
}

const busy = () => ({ approvals: [approval('n1')], asks: [ask('a1')] });
const sheet = (page: Page) => page.getByRole('dialog');

test('groups inbox items while menu and Main ping count only canonical channel requests', async ({
	page,
	context
}) => {
	const { resolveApproval } = await homeServer(context, { pending: busy() });
	await page.goto('/chats');
	await expect(page.getByRole('heading', { name: 'Channels', level: 1 })).toBeVisible();
	await expect(page.getByText('nightly-sync failed')).toBeVisible();
	await expect(page.getByRole('region', { name: 'Needs you', exact: true })).toContainText(
		'Approve send_email'
	);
	await expect(page.getByRole('region', { name: 'Needs you', exact: true })).toContainText(
		'Which day works'
	);
	await expect(page.locator('[data-inbox="shared"]')).toContainText('nightly-sync failed');
	await expect(page.locator('[data-inbox="shared"]')).toContainText('Compare flight prices');
	const menu = page.getByRole('button', { name: /^Menu/ });
	await expect(menu).toHaveAccessibleName('Menu, 2 need you');
	await menu.click();
	const navigation = page.getByRole('dialog', { name: 'Menu' });
	await expect(navigation.getByRole('link', { name: 'Channels', exact: true })).toHaveAttribute(
		'href',
		'/chats'
	);
	// Channel pings count questions and approvals; jobs remain in the shared inbox.
	const mainChannel = navigation.getByRole('link', { name: /^Main(?:\s|$)/ });
	await expect(mainChannel).toHaveAccessibleName('Main 2 requests need you');
	await page.keyboard.press('Escape');
	resolveApproval('n1');
	await push(page, 'approval_resolved', { nonce: 'n1', decision: 'approve' }, 5);
	// The bot publishes this invalidation after committing the resolution to its channel log.
	await push(page, 'threads', { id: 'main' });
	await expect(menu).toHaveAccessibleName('Menu, 1 need you');
	await expect(page.getByText('Approve send_email')).toBeHidden();
	await menu.click();
	await expect(mainChannel).toHaveAccessibleName('Main 1 requests need you');
});

test('a quiet day says nothing needs you, with a way into the chat', async ({ page, context }) => {
	await homeServer(context, { fixtures: 'empty' });
	await page.goto('/chats');
	await expect(page.getByText('Nothing needs you')).toBeVisible();
	await page.getByRole('link', { name: /^Main chat/ }).click();
	await expect(page).toHaveURL(/\/chat$/);
});

test('a slow server shows a labelled skeleton, never a blank screen', async ({ page, context }) => {
	await homeServer(context, { fixtures: 'slow', streamStatus: 503 });
	await page.goto('/chats');
	await expect(
		page.getByRole('status').filter({ hasText: 'Loading what needs you' })
	).toBeAttached();
	await expect(page.getByText('nightly-sync failed')).toBeVisible({ timeout: 6000 });
});

test('a slow server part keeps the waiting items and says what is still loading', async ({
	page,
	context
}) => {
	await homeServer(context, { pending: busy(), fixtures: 'slow' });
	await page.goto('/chats');
	await expect(page.getByText('Approve send_email')).toBeVisible();
	await expect(page.getByText('Loading failed and running work…')).toBeVisible();
	await expect(page.getByText('nightly-sync failed')).toBeVisible({ timeout: 6000 });
});

test('a failed server part keeps approvals on screen and retries', async ({ page, context }) => {
	const { backend } = await homeServer(context, { pending: busy(), fixtures: 'error' });
	await page.goto('/chats');
	await expect(page.getByText('Approve send_email')).toBeVisible();
	const alert = page
		.getByRole('alert')
		.filter({ hasText: "Couldn't load failed and running work" });
	await expect(alert).toBeVisible();
	backend.set('home', 'normal');
	await alert.getByRole('button', { name: 'Try again' }).click();
	await expect(page.getByText('nightly-sync failed')).toBeVisible();
	await expect(alert).toBeHidden();
});

test('a server error with nothing loaded shows an error and Retry', async ({ page, context }) => {
	const { backend } = await homeServer(context, { fixtures: 'error', streamStatus: 503 });
	await page.goto('/chats');
	await expect(page.getByText("Couldn't load your inbox.")).toBeVisible();
	backend.set('home', 'normal');
	await page
		.getByLabel('Inbox', { exact: true })
		.getByRole('button', { name: 'Try again' })
		.click();
	await expect(page.getByText('nightly-sync failed')).toBeVisible();
});

test('an unreachable agent says running work may be missing', async ({ page, context }) => {
	await homeServer(context, { pending: busy(), fixtures: 'offline' });
	await page.goto('/chats');
	await expect(
		page.getByText("Can't reach the agent, so running and failed work may be missing.")
	).toBeVisible();
	await expect(page.getByText('Approve send_email')).toBeVisible();
});

test('going offline shows the banner and keeps what was loaded', async ({ page, context }) => {
	await homeServer(context, { pending: busy() });
	await page.goto('/chats');
	await expect(page.getByText('nightly-sync failed')).toBeVisible();
	await context.setOffline(true);
	await expect(page.getByText(/offline/i).first()).toBeVisible();
	await expect(page.getByText('nightly-sync failed')).toBeVisible();
	await context.setOffline(false);
});

test('an approval peeks in a sheet with the real tray, held for a moment, and back closes it', async ({
	page,
	context
}) => {
	const { posts } = await homeServer(context, { pending: busy() });
	await page.goto('/chats');
	await page.getByRole('button', { name: /Approve send_email/ }).click();
	const dialog = sheet(page);
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('heading', { name: 'Approval needed' })).toBeVisible();
	const approve = dialog.getByRole('button', { name: 'Approve send_email' });
	await expect(approve).toBeDisabled();
	await expect(approve).toBeEnabled({ timeout: 2000 });
	await page.goBack();
	await expect(dialog).toBeHidden();
	await expect(page).toHaveURL(/\/chats$/);
	expect(posts('/api/chat/approvals/')).toEqual([]);
});

test('approving from the sheet posts the decision and says what happened', async ({
	page,
	context
}) => {
	const { posts } = await homeServer(context, { pending: busy() });
	await page.goto('/chats');
	await page.getByRole('button', { name: /Approve send_email/ }).click();
	const approve = sheet(page).getByRole('button', { name: 'Approve send_email' });
	await expect(approve).toBeEnabled({ timeout: 2000 });
	await approve.click();
	await expect
		.poll(() => posts('/api/chat/approvals/n1').map((c) => c.body))
		.toEqual([{ decision: 'approve' }]);
	await expect(sheet(page).getByText('Approved. The agent carries on.')).toBeVisible();
	await push(page, 'approval_resolved', { nonce: 'n1', decision: 'approve' }, 5);
	await expect(sheet(page).getByText('Approved. The agent carries on.')).toBeVisible();
	await sheet(page).getByRole('button', { name: 'Close', exact: true }).click();
	await expect(sheet(page)).toBeHidden();
	await expect(page.getByText('Approve send_email')).toBeHidden();
});

test('a decision that fails to send says so in the sheet and can be tried again', async ({
	page,
	context
}) => {
	await homeServer(context, { pending: busy(), decide: 500 });
	await page.goto('/chats');
	await page.getByRole('button', { name: /Approve send_email/ }).click();
	await sheet(page).getByRole('button', { name: 'Deny send_email' }).click();
	await expect(sheet(page).getByRole('alert')).toHaveText(
		"The agent couldn't take your decision. Try again."
	);
	await expect(sheet(page).getByRole('button', { name: 'Deny send_email' })).toBeVisible();
});

test('a question answers from the sheet with the ask card', async ({ page, context }) => {
	const { posts } = await homeServer(context, { pending: busy() });
	await page.goto('/chats');
	await page.getByRole('button', { name: /Which day works/ }).click();
	await sheet(page).getByRole('button', { name: 'Saturday' }).click();
	await expect
		.poll(() => posts('/api/chat/asks/a1').map((c) => c.body))
		.toEqual([{ index: 1, label: 'Saturday' }]);
	await expect(sheet(page).getByText('Sent. The agent has your answer.')).toBeVisible();
});

test('a failed job peeks with its error, and Dismiss takes it off Home', async ({
	page,
	context
}) => {
	await homeServer(context);
	await page.goto('/chats');
	await page.getByRole('button', { name: /nightly-sync failed/ }).click();
	await expect(sheet(page).getByText('rsync: connection to backup.lan timed out')).toBeVisible();
	await expect(sheet(page).getByRole('button', { name: 'View activity' })).toBeVisible();
	await sheet(page).getByRole('button', { name: 'Dismiss' }).click();
	await expect(sheet(page)).toBeHidden();
	await expect(page.getByText('nightly-sync failed')).toBeHidden();
});

test('Ask the agent pushes chat above review, with the alert quoted', async ({ page, context }) => {
	await homeServer(context);
	await page.goto('/chat');
	await (await openDrawer(page)).getByRole('link', { name: 'Channels' }).click();
	await page.getByRole('button', { name: /nightly-sync failed/ }).click();
	await sheet(page).getByRole('button', { name: 'Ask the agent' }).click();
	await sheet(page).getByRole('button', { name: 'Main chat', exact: true }).click();
	await expect(page).toHaveURL(/\/chat$/);
	await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(
		/^> Scheduled job nightly-sync failed\n> rsync/
	);
	await page.goBack();
	await expect(page).toHaveURL(/\/chats\?item=/);
	await expect(sheet(page)).toBeVisible();
	await page.goBack();
	await expect(sheet(page).getByRole('heading', { name: 'nightly-sync failed' })).toBeVisible();
	await page.goBack();
	await expect(page).toHaveURL(/\/chats$/);
	await expect(sheet(page)).toBeHidden();
});

test('from a cold inbox link, discussion preserves the review in history', async ({
	page,
	context
}) => {
	await homeServer(context);
	await page.goto('/chats');
	await page.getByRole('button', { name: /nightly-sync failed/ }).click();
	await sheet(page).getByRole('button', { name: 'Ask the agent' }).click();
	await sheet(page).getByRole('button', { name: 'Main chat', exact: true }).click();
	await expect(page).toHaveURL(/\/chat$/);
	await page.goBack();
	await expect(page).toHaveURL(/\/chats\?item=/);
	await expect(sheet(page)).toBeVisible();
});

for (const [link, item, text] of [
	['/?approve=n1', 'approval', 'Approval needed'],
	['/?ask=a1', 'ask', 'Which day works for the car service?'],
	['/home?item=job%3Anightly-sync', 'job alert', 'rsync: connection to backup.lan']
] as const) {
	test(`a cold push link to an ${item} opens it on Home (${link})`, async ({ page, context }) => {
		await homeServer(context, { pending: busy() });
		await page.goto(link);
		await expect(sheet(page)).toBeVisible();
		await expect(sheet(page).getByText(text).first()).toBeVisible();
		expect(new URL(page.url()).pathname).toBe('/assistant');
		expect(new URL(page.url()).search).toBe(new URL(link, 'https://example.test').search);
	});
}

test('dismissing a job alert opened from its push link stays on Home', async ({
	page,
	context
}) => {
	await homeServer(context, { pending: busy() });
	await page.goto('/home?item=job%3Anightly-sync');
	await sheet(page).getByRole('button', { name: 'Dismiss' }).click();
	await expect(sheet(page)).toBeHidden();
	await expect(page).toHaveURL(/\/assistant$/);
});

test('a cold link to something already handled says so instead of waiting', async ({
	page,
	context
}) => {
	await homeServer(context, { pending: busy() });
	await page.goto('/inbox?approve=gone');
	await expect(sheet(page).getByRole('heading', { name: 'Already handled' })).toBeVisible();
	await expect(sheet(page).getByText("This isn't waiting any more.")).toBeVisible();
	await sheet(page).getByRole('button', { name: 'Close', exact: true }).click();
	await expect(sheet(page)).toBeHidden();
	await page.reload();
	await expect(page.getByText('nightly-sync failed')).toBeVisible();
	await expect(sheet(page)).toBeHidden();
});

test('a cold link with the stream refused says it cannot check, without spinning', async ({
	page,
	context
}) => {
	await homeServer(context, { streamStatus: 403 });
	await page.goto('/inbox?ask=a1');
	await expect(sheet(page).getByRole('heading', { name: "Can't check this now" })).toBeVisible();
	await expect(sheet(page).getByText("can't be checked right now")).toBeVisible();
});

for (const colorScheme of ['light', 'dark'] as const) {
	test(`Home and its sheets pass axe, 48px targets and reflow in ${colorScheme}`, async ({
		page,
		context
	}) => {
		// Inspect settled colors; sheet-motion.test.ts covers animated opening and dismissal.
		await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
		await homeServer(context, { pending: busy() });
		await page.goto('/chats');
		await expect(page.getByText('nightly-sync failed')).toBeVisible();
		expect(await axe(page)).toEqual([]);
		expect(await smallTargets(page)).toEqual([]);
		for (const name of [
			/Approve send_email/,
			/Which day works/,
			/nightly-sync failed/,
			/Compare flight/,
			/Main chat/
		]) {
			const row = page.getByRole('button', { name }).first();
			if (!(await row.count())) continue;
			await row.click();
			await expect(sheet(page)).toBeVisible();
			expect(await axe(page), String(name)).toEqual([]);
			expect(await smallTargets(page), String(name)).toEqual([]);
			await page.goBack();
			await expect(sheet(page)).toBeHidden();
		}
		for (const width of [412, 320]) {
			await page.setViewportSize({ width, height: 800 });
			expect(await horizontalOverflow(page), `overflow at ${width}px`).toEqual([]);
		}
	});
}

test('an alert or run event refetches Home, so a new failure shows without a reload', async ({
	page,
	context
}) => {
	const { backend } = await homeServer(context, { fixtures: 'empty' });
	await page.goto('/chats');
	await expect(page.getByText('Nothing needs you')).toBeVisible();
	const loads = () => backend.calls.filter((c) => c.method === 'GET' && c.path === '/api/home');
	const before = loads().length;
	backend.set('home', 'normal');
	await push(
		page,
		'alert',
		{
			key: 'o1',
			text: 'nightly-sync failed',
			alert: {
				source: 'job',
				job: 'nightly-sync',
				kind: 'failed',
				trigger: 'daily',
				startedAt: new Date().toISOString(),
				schedule: 'daily 02:00'
			}
		},
		9
	);
	await push(page, 'run', {
		runId: '01K6B4D2F4H6K8M0P2R4T6V8X0',
		kind: 'subagent',
		status: 'running'
	});
	await expect(page.getByText('nightly-sync failed')).toBeVisible();
	expect(loads().length).toBe(before + 1);
	await push(page, 'alert_cleared', { id: 'job:nightly-sync', reason: 'recovered' }, 10);
	await expect(page.getByText('nightly-sync failed')).toBeHidden();
});

test("an agent answer outside the contract says Home's running work couldn't be read", async ({
	page,
	context
}) => {
	await homeServer(context, { pending: busy(), fixtures: 'bad' });
	await page.goto('/chats');
	await expect(
		page.getByText("The agent's list of running and failed work couldn't be read")
	).toBeVisible();
	await expect(page.getByText('Approve send_email')).toBeVisible();
});

test('a cold link to a job alert that has cleared says Already handled', async ({
	page,
	context
}) => {
	await homeServer(context, { fixtures: 'empty' });
	await page.goto('/inbox?item=job%3Anightly-sync');
	await expect(sheet(page).getByRole('heading', { name: 'Already handled' })).toBeVisible();
	await expect(page).toHaveURL(/\/assistant\?item=job%3Anightly-sync$/);
});

test('opening a run tells the bot once, and it stays in the inbox as read on every device', async ({
	page,
	context
}) => {
	const { backend } = await homeServer(context);
	await page.goto('/chats');
	await page.getByRole('button', { name: /Draft the quarterly expenses summary/ }).click();
	await sheet(page).getByRole('button', { name: 'View activity' }).click();
	await expect(page).toHaveURL(/\/runs\//);
	await expect
		.poll(() => backend.calls.filter((c) => c.path === '/api/home/opened').map((c) => c.body))
		.toEqual([{ id: 'run:01K6B3A1C3E5G7J9M1P3R5T7V9' }]);
	await page.reload();
	await page.goto('/chats');
	await expect(
		page.getByRole('button', { name: /Read: Draft the quarterly expenses summary/ })
	).toBeVisible();
	await expect(page.getByRole('button', { name: /Your passport renewal/ })).not.toContainText(
		'Read:'
	);
});

test("a job's message opens in full, Discuss attaches it to the chat as a card, and it stays read", async ({
	page,
	context
}) => {
	const { backend } = await homeServer(context);
	await page.goto('/chats');
	await page.getByRole('button', { name: /Your passport renewal is due Friday/ }).click();
	await expect(sheet(page).getByRole('heading', { name: 'From heartbeat' })).toBeVisible();
	await expect(sheet(page).locator('strong', { hasText: 'Friday' })).toBeVisible();
	await expect
		.poll(() => backend.calls.filter((c) => c.path === '/api/home/opened').map((c) => c.body))
		.toEqual([{ id: 'msg:ob-heartbeat-1' }]);
	await sheet(page).getByRole('button', { name: 'Discuss', exact: true }).click();
	await sheet(page).getByRole('button', { name: 'Main chat', exact: true }).click();
	await expect(page).toHaveURL(/\/chat$/);
	const card = page.getByRole('region', { name: 'Replying to heartbeat', exact: true });
	await expect(card).toContainText('Your passport renewal is due Friday');
	await expect(card.getByRole('link', { name: 'View run' })).toHaveAttribute(
		'href',
		`/runs/${RUN_IDS.weeklyDeps}`
	);
	await expect(page.getByRole('textbox')).toHaveValue('');
	await card.getByRole('button', { name: 'Remove the reference' }).click();
	await expect(card).toBeHidden();
	await (await openDrawer(page)).getByRole('link', { name: 'Channels' }).click();
	await expect(page.getByRole('button', { name: /Read: Your passport renewal/ })).toBeVisible();
});

test("tapping a heartbeat item's reply sends it to Main with the item attached", async ({
	page,
	context
}) => {
	const { posts } = await homeServer(context);
	await page.goto('/chats');
	await page.getByRole('button', { name: /lucid mutation tests failing/ }).click();
	await expect(sheet(page).getByRole('heading', { name: 'From heartbeat' })).toBeVisible();
	const item = sheet(page).getByRole('region', { name: 'lucid mutation tests failing' });
	await expect(item.getByRole('link', { name: 'Open' })).toHaveAttribute(
		'href',
		'https://github.com/drklee3/lucid/actions'
	);
	await item.getByRole('button', { name: 'Remind me tomorrow' }).click();
	await expect
		.poll(() => posts('/api/chat/messages').map((c) => c.body))
		.toEqual([
			expect.objectContaining({
				text: 'Remind me tomorrow',
				ref: { id: `msg:${HEARTBEAT_ITEMS_KEY}`, item: 'lucid:mutants:main', choice: 1 }
			})
		]);
	await expect(item).toContainText('You replied: Remind me tomorrow');
	await expect(
		sheet(page).getByRole('status').filter({ hasText: 'Sent to Main chat' })
	).toBeVisible();

	// A typed reply to the other item goes the same way, without a choice.
	const other = sheet(page).getByRole('region', { name: '6 deployment reviews pending' });
	await other.getByRole('button', { name: 'Reply' }).click();
	await other.getByRole('textbox', { name: /Your own reply/ }).fill('Approve the two oldest');
	await other.getByRole('button', { name: 'Send reply' }).click();
	await expect
		.poll(() => posts('/api/chat/messages').map((c) => (c.body as { ref?: unknown }).ref))
		.toContainEqual({ id: `msg:${HEARTBEAT_ITEMS_KEY}`, item: 'sushii:deploy-reviews' });

	await page.goto('/chat');
	await expect(
		page.getByRole('region', { name: 'Replying to heartbeat: lucid mutation tests failing' })
	).toBeVisible();
});

test("Not useful mutes the item's topic at once, narrows to the item, and undoes in place", async ({
	page,
	context
}) => {
	const { posts } = await homeServer(context);
	await page.goto('/chats');
	await page.getByRole('button', { name: /lucid mutation tests failing/ }).click();
	const item = sheet(page).getByRole('region', { name: 'lucid mutation tests failing' });
	await expect(item).toContainText('CI failures');
	await item.getByRole('button', { name: 'Useful', exact: true }).click();
	await expect(item.getByRole('button', { name: 'Useful', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await item.getByRole('button', { name: 'Not useful' }).click();
	await expect(item.getByRole('status')).toHaveText(/You won't see “CI failures” again/);
	await item.getByRole('button', { name: 'Only this item' }).click();
	await expect(item.getByRole('status')).toHaveText(/You won't see this again/);
	await item.getByRole('button', { name: 'Undo' }).click();
	await expect(item.getByRole('button', { name: 'Not useful' })).toBeVisible();
	await expect
		.poll(() => posts('/api/home/rate').map((c) => c.body))
		.toEqual([
			{ id: `msg:${HEARTBEAT_ITEMS_KEY}`, item: 'lucid:mutants:main', value: 'up' },
			{
				id: `msg:${HEARTBEAT_ITEMS_KEY}`,
				item: 'lucid:mutants:main',
				value: 'down',
				scope: 'topic'
			},
			{
				id: `msg:${HEARTBEAT_ITEMS_KEY}`,
				item: 'lucid:mutants:main',
				value: 'down',
				scope: 'item'
			},
			{ id: `msg:${HEARTBEAT_ITEMS_KEY}`, item: 'lucid:mutants:main', value: null }
		]);
	// The message itself stays on Home.
	await expect(item).toBeVisible();
});

test('Done takes an item off Home on every device, and Undo brings it back', async ({
	page,
	context
}) => {
	const { backend } = await homeServer(context);
	await page.goto('/chats');
	await page.getByRole('button', { name: /Your passport renewal/ }).click();
	await sheet(page).getByRole('button', { name: 'Done' }).click();
	await expect(page.getByRole('dialog')).toBeHidden();
	await expect(page.getByRole('button', { name: /Your passport renewal/ })).toBeHidden();
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(page.getByRole('button', { name: /Your passport renewal/ })).toBeVisible();
	await expect
		.poll(() => backend.calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body]))
		.toEqual([
			['/api/home/opened', { id: 'msg:ob-heartbeat-1' }],
			['/api/home/dismiss', { id: 'msg:ob-heartbeat-1' }],
			['/api/home/restore', { id: 'msg:ob-heartbeat-1' }]
		]);
	await page.getByRole('button', { name: /Draft the quarterly expenses summary/ }).click();
	await sheet(page).getByRole('button', { name: 'Done' }).click();
	await page.reload();
	await expect(page.getByRole('button', { name: /Your passport renewal/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Draft the quarterly expenses/ })).toBeHidden();
});

test('swiping an inbox row sideways marks it done', async ({ page, context }) => {
	const { backend } = await homeServer(context);
	await page.goto('/chats');
	const row = page.getByRole('button', { name: /Your passport renewal/ });
	const box = (await row.boundingBox())!;
	const y = box.y + box.height / 2;
	const touch = { pointerType: 'touch', isPrimary: true, pointerId: 7 };
	// A short swipe snaps back and doesn't eat the next tap.
	await row.dispatchEvent('pointerdown', { ...touch, clientX: box.x + 200, clientY: y });
	await row.dispatchEvent('pointermove', { ...touch, clientX: box.x + 170, clientY: y });
	await row.dispatchEvent('pointerup', { ...touch, clientX: box.x + 170, clientY: y });
	await row.click();
	await expect(sheet(page).getByRole('heading', { name: 'From heartbeat' })).toBeVisible();
	await page.goBack();
	await expect(page.getByRole('dialog')).toBeHidden();
	await row.dispatchEvent('pointerdown', { ...touch, clientX: box.x + box.width - 20, clientY: y });
	for (const dx of [20, 60, 120, 200, 260]) {
		await row.dispatchEvent('pointermove', {
			...touch,
			clientX: box.x + box.width - 20 - dx,
			clientY: y
		});
	}
	await row.dispatchEvent('pointerup', { ...touch, clientX: box.x + 20, clientY: y });
	await expect(row).toBeHidden();
	await expect(page.getByRole('dialog')).toBeHidden();
	await expect
		.poll(() => backend.calls.filter((c) => c.path === '/api/home/dismiss').map((c) => c.body))
		.toEqual([{ id: 'msg:ob-heartbeat-1' }]);
});

test("a job message's push opens it on Home", async ({ page, context }) => {
	await homeServer(context);
	await page.goto('/inbox?item=msg%3Aob-heartbeat-1');
	await expect(sheet(page).getByRole('heading', { name: 'From heartbeat' })).toBeVisible();
});

test('a dismissed job is posted once and stays off Home after a reload', async ({
	page,
	context
}) => {
	const { backend } = await homeServer(context);
	await page.goto('/chats');
	await page.getByRole('button', { name: /nightly-sync failed/ }).click();
	await sheet(page).getByRole('button', { name: 'Dismiss' }).click();
	await expect(page.getByText('nightly-sync failed')).toBeHidden();
	expect(backend.calls.filter((c) => c.path === '/api/home/dismiss').map((c) => c.body)).toEqual([
		{ id: 'job:nightly-sync' }
	]);
	await page.reload();
	await expect(page.getByRole('button', { name: /Your passport renewal/ })).toBeVisible();
	await expect(page.getByText('nightly-sync failed')).toBeHidden();
});

test("a cold link to a job when Home's server part fails says it can't check, not handled", async ({
	page,
	context
}) => {
	await homeServer(context, { pending: busy(), fixtures: 'error' });
	await page.goto('/inbox?item=job%3Anightly-sync');
	await expect(sheet(page).getByRole('heading', { name: "Can't check this now" })).toBeVisible();
});

test("a cold link to a run while the agent is unreachable says it can't check", async ({
	page,
	context
}) => {
	await homeServer(context, { fixtures: 'offline' });
	await page.goto('/inbox?item=run%3A01K6B3A1C3E5G7J9M1P3R5T7V9');
	await expect(sheet(page).getByRole('heading', { name: "Can't check this now" })).toBeVisible();
});

test('launched on the chat, the menu counts canonical requests without counting failed jobs', async ({
	page,
	context
}) => {
	await homeServer(context, { pending: busy() });
	await page.goto('/');
	await expect(page).toHaveURL(/\/chat$/);
	await expect(page.getByRole('button', { name: /^Menu/ })).toHaveAccessibleName(
		'Menu, 2 need you'
	);
});
