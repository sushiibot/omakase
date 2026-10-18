import { expect, test, type Locator, type Page } from '@playwright/test';
import { fixtureApp, stubStream } from './helpers';

const harness = `http://localhost:${process.env.PW_HARNESS_PORT ?? 4174}/?surfaces`;

type Owner = 'first' | 'second' | 'other';

/** Who receives taps 1–7px into the gap between two neighbouring controls, from each side. */
async function gapOwners(first: Locator, second: Locator) {
	const a = await first.elementHandle();
	const b = await second.elementHandle();
	await first.scrollIntoViewIfNeeded();
	return first.page().evaluate(
		([a, b]) => {
			const ra = a!.getBoundingClientRect();
			const rb = b!.getBoundingClientRect();
			const across = rb.left >= ra.right;
			const owner = (x: number, y: number): Owner => {
				const hit = document.elementFromPoint(x, y);
				return hit && a!.contains(hit) ? 'first' : hit && b!.contains(hit) ? 'second' : 'other';
			};
			const centres = [
				owner((ra.left + ra.right) / 2, (ra.top + ra.bottom) / 2),
				owner((rb.left + rb.right) / 2, (rb.top + rb.bottom) / 2)
			];
			const fromFirst: Owner[] = [];
			const fromSecond: Owner[] = [];
			for (let d = 1; d <= 7; d++) {
				if (across) {
					const y = (Math.max(ra.top, rb.top) + Math.min(ra.bottom, rb.bottom)) / 2;
					fromFirst.push(owner(ra.right + d, y));
					fromSecond.push(owner(rb.left - d, y));
				} else {
					const x = (Math.max(ra.left, rb.left) + Math.min(ra.right, rb.right)) / 2;
					fromFirst.push(owner(x, ra.bottom + d));
					fromSecond.push(owner(x, rb.top - d));
				}
			}
			return { centres, fromFirst, fromSecond };
		},
		[a, b] as const
	);
}

type Taps = { click: Owner | 'none'; press: Owner | 'none' };

/**
 * The same sweep with real touchscreen taps, which Chromium's touch adjustment carries a few px past
 * any hit area. Capture listeners record whose click and whose pointerdown each tap became and
 * swallow both, so no handler runs and the surface stays put between taps.
 */
async function tapOwners(first: Locator, second: Locator) {
	const page = first.page();
	await first.scrollIntoViewIfNeeded();
	const a = await first.elementHandle();
	const b = await second.elementHandle();
	type W = { taps: Taps; stopTaps: () => void };
	await page.evaluate(
		([a, b]) => {
			const w = window as unknown as W;
			const owner = (e: Event) => {
				const t = e.target as Node;
				return a!.contains(t) ? 'first' : b!.contains(t) ? 'second' : 'other';
			};
			const click = (e: MouseEvent) => {
				w.taps.click = owner(e);
				e.preventDefault();
				e.stopImmediatePropagation();
			};
			const press = (e: PointerEvent) => {
				if (e.type === 'pointerdown') w.taps.press = owner(e);
				e.stopImmediatePropagation();
			};
			window.addEventListener('click', click, true);
			window.addEventListener('pointerdown', press, true);
			window.addEventListener('pointerup', press, true);
			w.stopTaps = () => {
				window.removeEventListener('click', click, true);
				window.removeEventListener('pointerdown', press, true);
				window.removeEventListener('pointerup', press, true);
			};
		},
		[a, b] as const
	);
	try {
		const ra = (await first.boundingBox())!;
		const rb = (await second.boundingBox())!;
		const across = rb.x >= ra.x + ra.width;
		// A tap always clicks something, so wait for its click before reading or tapping again.
		const tap = async (x: number, y: number) => {
			await page.evaluate(() => ((window as unknown as W).taps = { click: 'none', press: 'none' }));
			await page.touchscreen.tap(x, y);
			await expect
				.poll(() => page.evaluate(() => (window as unknown as W).taps.click), { timeout: 2000 })
				.not.toBe('none');
			return page.evaluate(() => (window as unknown as W).taps);
		};
		const centre = { first: await tap(ra.x + ra.width / 2, ra.y + ra.height / 2) };
		const centreSecond = await tap(rb.x + rb.width / 2, rb.y + rb.height / 2);
		expect([centre.first.click, centreSecond.click], 'centre taps land on their control').toEqual([
			'first',
			'second'
		]);
		const fromFirst: Taps[] = [];
		const fromSecond: Taps[] = [];
		// Touch points land on whole CSS px, so stop short of the midpoint where two 8px reaches meet.
		for (let d = 1; d <= 6; d++) {
			if (across) {
				const y = (Math.max(ra.y, rb.y) + Math.min(ra.y + ra.height, rb.y + rb.height)) / 2;
				fromFirst.push(await tap(ra.x + ra.width + d, y));
				fromSecond.push(await tap(rb.x - d, y));
			} else {
				const x = (Math.max(ra.x, rb.x) + Math.min(ra.x + ra.width, rb.x + rb.width)) / 2;
				fromFirst.push(await tap(x, ra.y + ra.height + d));
				fromSecond.push(await tap(x, rb.y - d));
			}
		}
		return { fromFirst, fromSecond };
	} finally {
		await page.evaluate(() => (window as unknown as W).stopTaps());
	}
}

/** Taps next to one control never land on the other, whichever side they start from. */
async function expectNearerOrNothing(first: Locator, second: Locator) {
	const { centres, fromFirst, fromSecond } = await gapOwners(first, second);
	expect(centres, 'each centre resolves to its control').toEqual(['first', 'second']);
	expect(fromFirst, 'taps past the first control').not.toContain('second');
	expect(fromSecond, 'taps past the second control').not.toContain('first');
	const taps = await tapOwners(first, second);
	const owners = (list: Taps[]) => list.flatMap((t) => [t.click, t.press]);
	expect(owners(taps.fromFirst), 'real taps past the first control').not.toContain('second');
	expect(owners(taps.fromSecond), 'real taps past the second control').not.toContain('first');
}

async function surfaces(page: Page) {
	await page.goto(harness);
	expect(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(true);
}

test('inline chat approval keeps Deny, Approve and Exact input apart on touch', async ({
	page
}) => {
	await surfaces(page);
	const inline = page.locator('[data-surface-probe="inline"]');
	const deny = inline.getByRole('button', { name: /^Deny/ });
	const approve = inline.getByRole('button', { name: /^Approve/ });
	await expectNearerOrNothing(deny, approve);
	// Nothing in the decision row reaches into the disclosure above it.
	const exact = inline.locator('[data-slot=collapsible-trigger]');
	await exact.scrollIntoViewIfNeeded();
	const inside = await exact.evaluate((el) => {
		const r = el.getBoundingClientRect();
		return [1, 4, 7].map((d) => {
			const hit = document.elementFromPoint(r.left + 40, r.bottom - d);
			return !!hit && el.contains(hit);
		});
	});
	expect(inside).toEqual([true, true, true]);
	const right = (await deny.boundingBox())!;
	await page.touchscreen.tap(right.x + right.width + 6, right.y + right.height / 2);
	await expect(page.locator('[data-fired]')).not.toContainText('inline:approve');
});

test('agent approval card keeps Deny and Approve apart on touch', async ({ page }) => {
	await surfaces(page);
	const card = page.locator('[data-surface-probe="card"]');
	await expectNearerOrNothing(
		card.locator('[data-decision="decline"]'),
		card.locator('[data-decision="accept"]')
	);
});

test('tool confirmation keeps its choices apart in either order', async ({ page }) => {
	await surfaces(page);
	for (const probe of ['confirm-no-yes', 'confirm-yes-no']) {
		const buttons = page.locator(`[data-surface-probe="${probe}"] [data-slot="button"]`);
		await expect(buttons).toHaveCount(2);
		await expectNearerOrNothing(buttons.nth(0), buttons.nth(1));
	}
});

test('the voice bar keeps End call apart from its neighbours', async ({ page }) => {
	await surfaces(page);
	const voice = page.locator('[data-surface-probe="voice"]');
	const mute = voice.getByRole('button', { name: 'Mute microphone' });
	const interrupt = voice.getByRole('button', { name: 'Stop speaking' });
	const end = voice.getByRole('button', { name: 'End call' });
	await expectNearerOrNothing(mute, interrupt);
	await expectNearerOrNothing(interrupt, end);
});

test('the task action stack keeps Stop and Mark done apart on touch', async ({ page, context }) => {
	await fixtureApp(context);
	await page.goto('/tasks/t-notes');
	const ask = page.getByRole('button', { name: /Ask Sushii|Continue with Sushii/ });
	const stop = page.getByRole('button', { name: 'Stop active work' });
	const done = page.getByRole('button', { name: 'Mark done' });
	await expect(stop).toBeVisible();
	await expectNearerOrNothing(ask, stop);
	await expectNearerOrNothing(stop, done);
});

test('the task inspector keeps Ask, Stop and Mark done apart on touch', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await page.goto('/chat');
	await page.getByRole('button', { name: /^Tasks, \d+ open/ }).click();
	const panel = page.getByRole('complementary', { name: 'Conversation tasks' });
	await panel.getByRole('tab', { name: 'Tasks', exact: true }).click();
	await panel.getByRole('button', { name: /Review the deployment notes/ }).click();
	const inspector = panel.locator('[data-task-inspector]');
	const ask = inspector.getByRole('button', { name: /Ask Sushii|Continue with Sushii/ });
	const stop = inspector.getByRole('button', { name: 'Stop active work' });
	const done = inspector.getByRole('button', { name: 'Mark done' });
	await expect(stop).toBeVisible();
	await expectNearerOrNothing(ask, stop);
	await expectNearerOrNothing(stop, done);
});

test('the voice panel keeps its call controls apart on touch', async ({ page }) => {
	await surfaces(page);
	const panel = page.locator('[data-surface-probe="voice-panel"]');
	const mute = panel.getByRole('button', { name: 'Mute microphone' });
	const end = panel.getByRole('button', { name: 'End call' });
	const interrupt = panel.getByRole('button', { name: 'Stop speaking' });
	await expectNearerOrNothing(mute, end);
	await expectNearerOrNothing(end, interrupt);
	await expectNearerOrNothing(mute, interrupt);
});

test('the ask card keeps its typed answer apart from the answer chips on touch', async ({
	page
}) => {
	await surfaces(page);
	const card = page.locator('[data-surface-probe="ask"]');
	const chips = card.getByRole('group', { name: 'Answers' });
	const input = card.getByRole('textbox', { name: 'Your own answer' });
	await input.fill('Friday');
	const send = card.getByRole('button', { name: 'Send answer' });
	await expect(send).toBeEnabled();
	await expectNearerOrNothing(chips, send);
	await expectNearerOrNothing(chips, input);
	await expectNearerOrNothing(card.getByRole('button', { name: 'Later this month' }), send);
});

test('an unsent message keeps Delete and Retry send apart on touch', async ({ page, context }) => {
	await stubStream(context);
	await context.route('**/api/**', async (route) => {
		const path = new URL(route.request().url()).pathname;
		const json = (data: unknown, status = 200) =>
			route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
		if (path === '/api/chat/history') return json({ items: [], before: null });
		if (path === '/api/chat/messages') return json({ error: 'bad' }, 400);
		if (path === '/api/chat/seen') return route.fulfill({ status: 204 });
		return route.fulfill({ status: 404, body: 'Not found' });
	});
	await page.goto('/chat');
	await page.getByRole('textbox', { name: 'Message' }).fill('This one fails');
	await page.getByRole('button', { name: 'Send message' }).click();
	const message = page.locator('[data-message-id]').filter({ hasText: 'This one fails' });
	await expect(message).toContainText('Failed');
	const copy = message.getByRole('button', { name: 'Copy your message' });
	const remove = message.getByRole('button', { name: 'Delete' });
	const retry = message.getByRole('button', { name: 'Retry send' });
	await expectNearerOrNothing(copy, remove);
	await expectNearerOrNothing(remove, retry);
});

/** Real touchscreen taps, which Chromium's touch adjustment carries a few px past any hit area. */
async function tapAll(page: Page, points: { x: number; y: number }[], reset?: () => Promise<void>) {
	for (const p of points) {
		await page.touchscreen.tap(p.x, p.y);
		await reset?.();
	}
}

const closeDetails = (page: Page, probe: string) => () =>
	page
		.locator(`[data-surface-probe="${probe}"] [data-slot=collapsible-trigger][aria-expanded=true]`)
		.evaluateAll((all) => all.forEach((t) => (t as HTMLElement).click()));

test('real taps on and just below a disclosure never fire the decision under it', async ({
	page
}) => {
	await surfaces(page);
	for (const [probe, decision, fired] of [
		['push', /^Cancel$/, 'push:'],
		['inline', /^Deny/, 'inline:']
	] as const) {
		const surface = page.locator(`[data-surface-probe="${probe}"]`);
		const summary = surface.locator('[data-slot=collapsible-trigger]').first();
		await summary.scrollIntoViewIfNeeded();
		const s = (await summary.boundingBox())!;
		const d = (await surface.getByRole('button', { name: decision }).boundingBox())!;
		const x = d.x + d.width / 2;
		const ys = Array.from({ length: 12 }, (_, i) => s.y + s.height - 4 + i);
		await tapAll(
			page,
			ys.map((y) => ({ x, y })),
			closeDetails(page, probe)
		);
		await expect(page.locator('[data-fired]')).not.toContainText(fired);
	}
});

test('real taps on the ask card answer field never send it or pick a chip', async ({ page }) => {
	await surfaces(page);
	const card = page.locator('[data-surface-probe="ask"]');
	const input = card.getByRole('textbox', { name: 'Your own answer' });
	await input.fill('Friday');
	await input.scrollIntoViewIfNeeded();
	const i = (await input.boundingBox())!;
	const chip = (await card.getByRole('button', { name: 'Later this month' }).boundingBox())!;
	const cy = i.y + i.height / 2;
	// Inside the field near Send, and across the gap up to its middle.
	const beside = Array.from({ length: 12 }, (_, n) => ({ x: i.x + i.width - 5 + n, y: cy }));
	// Inside the field near the chips, and up to 16px above it.
	const above = Array.from({ length: 18 }, (_, n) => ({
		x: chip.x + chip.width / 2,
		y: i.y + 1 - n
	}));
	await tapAll(page, [...beside, ...above]);
	await expect(page.locator('[data-fired]')).not.toContainText('ask:');
});

test('real taps in the agent transcript never reach the header Stop', async ({ page, context }) => {
	await fixtureApp(context);
	const posts: string[] = [];
	const agent = {
		id: 'a-run',
		machineId: 'pc',
		machineName: 'Desktop',
		rootId: 'code',
		provider: 'codex',
		title: 'Fix the login redirect',
		conversationId: 'main',
		remoteStatus: 'running',
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString()
	};
	const session = { status: 'running', attempts: 1, output: 'working', requests: [] };
	await context.route('**/api/agents**', async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (route.request().method() === 'POST') posts.push(path);
		if (path === '/api/agents') return route.fulfill({ json: { agents: [agent] } });
		return route.fulfill({ json: { agent, session } });
	});
	await page.goto('/agents/a-run');
	const stop = page.getByRole('button', { name: 'Stop', exact: true });
	await expect(stop).toBeVisible();
	const header = (await page.locator('[data-slot="page-header"]').boundingBox())!;
	const b = (await stop.boundingBox())!;
	const x = b.x + b.width / 2;
	await tapAll(
		page,
		Array.from({ length: 16 }, (_, n) => ({ x, y: header.y + header.height + 0.5 + n }))
	);
	expect(posts.filter((p) => p.endsWith('/stop'))).toEqual([]);
});

test('the approval tray keeps Details, Deny and Approve apart on touch', async ({ page }) => {
	await surfaces(page);
	await page.evaluate(() => {
		const { h } = window as unknown as {
			h: { step(fn: () => void): void; api: { setTray(n: string[]): void } };
		};
		h.step(() => h.api.setTray(['TRAYTRAYTRAYTRAY']));
	});
	const tray = page.locator('#tray');
	const deny = tray.getByRole('button', { name: /^Deny/ });
	const approve = tray.getByRole('button', { name: /^Approve/ });
	await expect(approve).toBeEnabled();
	await expectNearerOrNothing(deny, approve);
	await expectNearerOrNothing(tray.getByRole('button', { name: 'Show details' }), approve);
});

test('file store rows keep Remove apart from its neighbours on touch', async ({
	page,
	context
}) => {
	const store = {
		id: '12345678-1234-4234-8234-123456789abc',
		revision: 1,
		name: 'Property documents',
		endpoint: 'https://fileserver:5006',
		folders: [
			{ path: '/public/Property', writable: false },
			{ path: '/public/Scans', writable: true }
		],
		username: 'property-agent',
		certificateSha256: '',
		enabled: true
	};
	await stubStream(context);
	await context.route('**/api/**', (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === '/api/channels') return route.fulfill({ json: { channels: [] } });
		if (path === '/api/me') return route.fulfill({ json: { login: 'owner@example.test' } });
		if (path === '/api/file-stores') return route.fulfill({ json: { stores: [store] } });
		return route.fulfill({ status: 404, json: { error: 'Not found' } });
	});
	await page.goto('/file-stores');
	const row = page.getByRole('listitem').filter({ hasText: 'Property documents' });
	const edit = row.getByRole('button', { name: 'Edit', exact: true });
	const remove = row.getByRole('button', { name: 'Remove', exact: true });
	await expectNearerOrNothing(edit, remove);
	await remove.click();
	await expectNearerOrNothing(
		row.getByRole('button', { name: 'Remove connection' }),
		row.getByRole('button', { name: 'Keep connection' })
	);
	await row.getByRole('button', { name: 'Keep connection' }).click();
	await edit.click();
	await expectNearerOrNothing(
		page.getByRole('switch', { name: 'Allow writes for folder 1' }),
		page.getByRole('button', { name: 'Remove folder 1' })
	);
	await expectNearerOrNothing(
		page.getByRole('button', { name: 'Remove folder 2' }),
		page.getByRole('button', { name: 'Add folder' })
	);
});

test('the archive sheet keeps Archive apart from Keep current on touch', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await page.goto('/chats/oct-trip');
	await page.getByRole('button', { name: 'Chat commands', exact: true }).click();
	await page.getByRole('button', { name: 'Archive conversation', exact: true }).click();
	const archive = page.getByRole('dialog', { name: 'Archive conversation' });
	await expect(archive).toBeVisible();
	await expectNearerOrNothing(
		archive.getByRole('button', { name: 'Archive conversation', exact: true }),
		archive.getByRole('button', { name: 'Keep current' })
	);
});

test('the branch sheet keeps Start conversation apart from Cancel on touch', async ({
	page,
	context
}) => {
	await fixtureApp(context, {
		history: [
			{
				type: 'assistant',
				id: 'a1',
				at: new Date().toISOString(),
				text: 'Three hotels fit.',
				tools: [],
				files: []
			}
		]
	});
	await page.goto('/chat');
	await page.getByRole('button', { name: 'Start a conversation from here' }).click();
	const branch = page.getByRole('dialog', { name: 'Start a conversation' });
	await branch.getByRole('textbox', { name: 'Conversation name' }).fill('Hotel choice');
	await expectNearerOrNothing(
		branch.getByRole('button', { name: 'Start conversation' }),
		branch.getByRole('button', { name: 'Cancel', exact: true })
	);
});
