import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { axe, horizontalOverflow, smallTargets, stubStream, openDrawer } from './helpers';

const ENDPOINT = 'https://push.example.test/sub/abc';
const PUBLIC_KEY =
	'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const KEY_BYTES = [...Buffer.from(PUBLIC_KEY, 'base64url')];

type Call = { method: string; path: string; body: string | null; contentType?: string };
type ApiOptions = {
	meStatus?: number;
	keyStatus?: number;
	subscribeStatus?: number;
	ownerName?: string | null;
	nameStatus?: number;
};

// Context-level, so requests from the service worker are mocked as well as the page's.
async function mockApi(context: BrowserContext, initial: ApiOptions = {}) {
	const opts = {
		meStatus: 200,
		keyStatus: 200,
		subscribeStatus: 200,
		ownerName: 'Sam' as string | null,
		nameStatus: 200,
		...initial
	};
	const calls: Call[] = [];
	await stubStream(context);
	await context.route('**/api/**', async (route) => {
		const req = route.request();
		const path = new URL(req.url()).pathname;
		calls.push({
			method: req.method(),
			path,
			body: req.postData(),
			contentType: req.headers()['content-type']
		});
		const json = (data: unknown, status = 200) =>
			route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
		if (path === '/api/file-stores') return json({ stores: [] });
		if (path === '/api/me') {
			if (opts.meStatus !== 200) return route.fulfill({ status: opts.meStatus, body: 'Forbidden' });
			return json({ login: 'drk@example.com' });
		}
		if (path === '/api/push/key') {
			if (opts.keyStatus !== 200) return route.fulfill({ status: opts.keyStatus, body: 'Nope' });
			return json({ publicKey: PUBLIC_KEY });
		}
		if (path === '/api/push/subscribe') {
			if (req.method() === 'POST' && opts.subscribeStatus !== 200) {
				return route.fulfill({ status: opts.subscribeStatus, body: 'Broken' });
			}
			return json({ ok: true });
		}
		if (path === '/api/push/test') return json({ sent: 1, pruned: 0 });
		if (path === '/api/settings/owner-name') {
			if (req.method() !== 'POST') return json({ name: opts.ownerName });
			if (opts.nameStatus !== 200)
				return json({ error: 'Use one line, without control characters.' }, opts.nameStatus);
			const { name } = JSON.parse(req.postData() ?? '{}') as { name: string | null };
			opts.ownerName = name?.trim() || null;
			return json({ name: opts.ownerName });
		}
		if (path === '/api/chat/history') return json({ items: [], before: null });
		if (path === '/api/chat/seen') return route.fulfill({ status: 204 });
		return route.fulfill({ status: 404, body: 'Not found' });
	});
	const subscribes = () =>
		calls.filter((c) => c.method === 'POST' && c.path === '/api/push/subscribe');
	return { calls, opts, subscribes };
}

// Headless Chromium has no push service, so PushManager is faked. The subscription lives in
// localStorage so it survives reloads the way a real one does.
async function stubPush(page: Page) {
	await page.addInitScript((endpoint) => {
		const STORE = 'fake-push-sub';
		type Stored = { key: number[] };
		const w = window as unknown as {
			__subscribeCalls: { userVisibleOnly: boolean; key: number[] }[];
			__unsubscribed: number;
		};
		w.__subscribeCalls = [];
		w.__unsubscribed = 0;
		const load = (): Stored | null => JSON.parse(localStorage.getItem(STORE) ?? 'null');
		const make = (stored: Stored) =>
			({
				endpoint,
				options: {
					userVisibleOnly: true,
					applicationServerKey: new Uint8Array(stored.key).buffer
				},
				toJSON: () => ({
					endpoint,
					expirationTime: null,
					keys: { p256dh: 'p256dh-key', auth: 'auth-key' }
				}),
				unsubscribe: async () => {
					localStorage.removeItem(STORE);
					w.__unsubscribed++;
					return true;
				}
			}) as unknown as PushSubscription;
		PushManager.prototype.getSubscription = async () => {
			const stored = load();
			return stored ? make(stored) : null;
		};
		PushManager.prototype.subscribe = async (options?: PushSubscriptionOptionsInit) => {
			const key = [...new Uint8Array(options?.applicationServerKey as ArrayBuffer)];
			w.__subscribeCalls.push({ userVisibleOnly: options?.userVisibleOnly ?? false, key });
			localStorage.setItem(STORE, JSON.stringify({ key }));
			return make({ key });
		};
	}, ENDPOINT);
}

async function seedSubscription(page: Page, key: number[]) {
	await page.evaluate(
		(k) => localStorage.setItem('fake-push-sub', JSON.stringify({ key: k })),
		key
	);
}

const subscribeCalls = (page: Page) =>
	page.evaluate(() => (window as unknown as { __subscribeCalls: unknown[] }).__subscribeCalls);

async function controlled(page: Page) {
	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.reload();
	await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

// vite preview serves the bot's Trusted Types directives, so every test also proves the app
// never hands a string to a DOM sink outside its allowlisted policies.
const ttErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
	const errors: string[] = [];
	ttErrors.set(page, errors);
	page.on('pageerror', (err) => {
		if (/trusted ?type|TrustedHTML|TrustedScriptURL/i.test(err.message)) errors.push(err.message);
	});
	page.on('console', (msg) => {
		if (/trusted ?type|TrustedHTML|TrustedScript/i.test(msg.text())) errors.push(msg.text());
	});
});
test.afterEach(async ({ page }) => {
	expect(ttErrors.get(page) ?? []).toEqual([]);
});

const toggleOf = (page: Page) => page.getByRole('switch', { name: /notify this device/i });

for (const outcome of ['activated', 'stalled', 'throws', 'controllerchange'] as const) {
	test(`chat Reload refreshes when the waiting worker ${outcome}`, async ({ page, context }) => {
		await mockApi(context);
		await page.addInitScript((outcome) => {
			const worker = Object.assign(new EventTarget(), {
				state: 'installed',
				postMessage(message: { type: string }) {
					if (message.type !== 'SKIP_WAITING') return;
					sessionStorage.setItem('update-requested', 'yes');
					if (outcome === 'throws') throw new Error('Worker is gone');
					if (outcome === 'activated') {
						worker.state = 'activated';
						worker.dispatchEvent(new Event('statechange'));
					}
					if (outcome === 'controllerchange') {
						navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
					}
				}
			});
			const reg = Object.assign(new EventTarget(), {
				waiting: sessionStorage.getItem('update-requested') ? null : worker,
				installing: null,
				pushManager: { getSubscription: async () => null }
			});
			Object.defineProperty(navigator.serviceWorker, 'controller', { value: {} });
			navigator.serviceWorker.register = async () => reg as unknown as ServiceWorkerRegistration;
			navigator.serviceWorker.getRegistration = async () =>
				reg as unknown as ServiceWorkerRegistration;
		}, outcome);
		await page.goto('/chat');
		const toast = page.getByLabel('App updates');
		await expect(toast).toBeVisible();
		const box = await toast.boundingBox();
		const main = await page.locator('main').boundingBox();
		expect(box!.y + box!.height).toBeLessThanOrEqual(main!.y);
		await Promise.all([
			page.waitForEvent('framenavigated', { predicate: (frame) => frame === page.mainFrame() }),
			toast.getByRole('button', { name: 'Reload' }).click()
		]);
		await expect(toast).toHaveCount(0);
		expect(await page.evaluate(() => sessionStorage.getItem('update-requested'))).toBe('yes');
	});
}

test('settings shows the signed-in login', async ({ page, context }) => {
	await mockApi(context);
	await stubPush(page);
	await page.goto('/settings');
	await expect(page.getByTestId('login')).toHaveText('drk@example.com');
});

test('turning notifications on subscribes with the server key, and the test button sends', async ({
	page,
	context
}) => {
	await context.grantPermissions(['notifications']);
	const { calls, subscribes } = await mockApi(context);
	await stubPush(page);
	await page.goto('/settings');
	const toggle = toggleOf(page);
	await expect(toggle).toHaveAttribute('aria-checked', 'false');
	await expect(toggle).toBeEnabled();

	await toggle.click();
	// The first subscribe waits for the service worker to finish precaching.
	await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
	expect(KEY_BYTES).toHaveLength(65);
	expect(KEY_BYTES[0]).toBe(4);
	expect(await subscribeCalls(page)).toEqual([{ userVisibleOnly: true, key: KEY_BYTES }]);

	const sub = subscribes().at(-1)!;
	expect(sub.contentType).toBe('application/json');
	expect(JSON.parse(sub.body!)).toMatchObject({
		endpoint: ENDPOINT,
		keys: { p256dh: 'p256dh-key', auth: 'auth-key' }
	});

	await page.getByRole('button', { name: 'Send test notification' }).click();
	await expect(page.getByText('Sent to 1 device.')).toBeVisible();
	const sendTest = calls.find((c) => c.path === '/api/push/test')!;
	expect(sendTest.method).toBe('POST');
	expect(sendTest.body).toBeNull();
	expect(sendTest.contentType).toBeUndefined();

	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-checked', 'false');
	const del = calls.find((c) => c.method === 'DELETE')!;
	expect(del.contentType).toBe('application/json');
	expect(JSON.parse(del.body!)).toEqual({ endpoint: ENDPOINT });
});

test('a server failure while subscribing rolls the browser subscription back', async ({
	page,
	context
}) => {
	await context.grantPermissions(['notifications']);
	await mockApi(context, { subscribeStatus: 500 });
	await stubPush(page);
	await page.goto('/settings');
	const toggle = toggleOf(page);
	await toggle.click();
	await expect(page.getByRole('alert')).toContainText('The agent had a problem', {
		timeout: 15_000
	});
	await expect(toggle).toHaveAttribute('aria-checked', 'false');
	const state = await page.evaluate(() => ({
		unsubscribed: (window as unknown as { __unsubscribed: number }).__unsubscribed,
		stored: localStorage.getItem('fake-push-sub')
	}));
	expect(state).toEqual({ unsubscribed: 1, stored: null });
});

test('the app resends an existing subscription on every start, not only on settings', async ({
	page,
	context
}) => {
	await context.grantPermissions(['notifications']);
	const { subscribes } = await mockApi(context);
	await stubPush(page);
	await page.goto('/chat');
	await page.evaluate(() => navigator.serviceWorker.ready);
	await seedSubscription(page, KEY_BYTES);
	const before = subscribes().length;

	await page.reload();
	await expect(page.getByText('Say hi to your agent.')).toBeVisible();
	await expect.poll(() => subscribes().length).toBe(before + 1);
	expect(JSON.parse(subscribes().at(-1)!.body!)).toMatchObject({ endpoint: ENDPOINT });
	expect(subscribes().at(-1)!.contentType).toBe('application/json');

	// Landing on settings shares the start-up resend instead of sending a second one.
	await page.goto('/settings');
	await expect(toggleOf(page)).toHaveAttribute('aria-checked', 'true');
	await page.waitForTimeout(500);
	expect(subscribes().length).toBe(before + 2);
});

test('a subscription made with an old server key is replaced on start', async ({
	page,
	context
}) => {
	await context.grantPermissions(['notifications']);
	const { calls, subscribes } = await mockApi(context);
	await stubPush(page);
	await page.goto('/');
	await page.evaluate(() => navigator.serviceWorker.ready);
	await seedSubscription(page, [4, ...new Array(64).fill(7)]);
	await page.reload();
	await expect.poll(() => subscribes().length).toBe(1);
	expect(await subscribeCalls(page)).toEqual([{ userVisibleOnly: true, key: KEY_BYTES }]);
	expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/push/subscribe')).toBe(true);
});

test('a failed resend keeps notifications on, says so, and retries', async ({ page, context }) => {
	await context.grantPermissions(['notifications']);
	const { opts, subscribes } = await mockApi(context, { subscribeStatus: 500 });
	await stubPush(page);
	await page.goto('/');
	await page.evaluate(() => navigator.serviceWorker.ready);
	await seedSubscription(page, KEY_BYTES);
	await page.goto('/settings');

	const toggle = toggleOf(page);
	await expect(toggle).toHaveAttribute('aria-checked', 'true');
	await expect(page.getByRole('status').filter({ hasText: "Couldn't sync" })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Send test notification' })).toBeEnabled();

	opts.subscribeStatus = 200;
	const before = subscribes().length;
	await page.evaluate(() => dispatchEvent(new Event('online')));
	await expect.poll(() => subscribes().length).toBe(before + 1);
	await expect(page.getByText("Couldn't sync")).toBeHidden();
	await expect(toggle).toHaveAttribute('aria-checked', 'true');
});

test('the permission prompt waits until the server has a push key', async ({ page, context }) => {
	await mockApi(context, { keyStatus: 404 });
	await stubPush(page);
	await page.goto('/settings');
	await toggleOf(page).click();
	await expect(page.getByRole('alert')).toContainText("aren't set up on the server");
	expect(await page.evaluate(() => Notification.permission)).toBe('default');
});

test('denying the prompt shows the blocked help, and allowing it later re-enables the switch', async ({
	page,
	context
}) => {
	await mockApi(context);
	await stubPush(page);
	await page.goto('/settings');
	const toggle = toggleOf(page);
	await expect(toggle).toBeEnabled();
	// Headless Chromium answers an unanswered prompt with "denied".
	await toggle.click();
	await expect(page.getByText('Turn notifications back on')).toBeVisible();
	await expect(toggle).toBeDisabled();
	await expect(toggle).toHaveAccessibleDescription(/Blocked/);

	await context.grantPermissions(['notifications']);
	await expect(toggle).toBeEnabled();
	await expect(page.getByText('Turn notifications back on')).toBeHidden();
	await expect(toggle).toHaveAccessibleDescription(/Off for this device/);
});

test('without permission change events, coming back to the app re-checks the block', async ({
	page,
	context
}) => {
	await mockApi(context);
	await stubPush(page);
	await page.addInitScript(() => {
		Permissions.prototype.query = () => Promise.reject(new TypeError('unsupported'));
	});
	await page.goto('/settings');
	const toggle = toggleOf(page);
	await toggle.click();
	await expect(toggle).toHaveAccessibleDescription(/Blocked/);
	await expect(toggle).toBeDisabled();

	await context.grantPermissions(['notifications']);
	await page.waitForTimeout(300);
	await expect(toggle).toBeDisabled();
	await page.evaluate(() => dispatchEvent(new Event('focus')));
	await expect(toggle).toBeEnabled();
});

test('a failed account load says so and offers a retry', async ({ page, context }) => {
	await mockApi(context, { meStatus: 403 });
	await stubPush(page);
	await page.goto('/settings');
	await expect(page.getByRole('alert')).toContainText("isn't signed in as the owner");
	await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('going offline shows the banner', async ({ page, context }) => {
	await mockApi(context);
	await page.goto('/chat');
	await expect(page.getByText('Say hi to your agent.')).toBeVisible();
	await context.setOffline(true);
	await expect(
		page.getByText(
			'Offline. Messages send when you reconnect. Saved conversations are available on this device.'
		)
	).toBeVisible();
	await context.setOffline(false);
	await expect(
		page.getByText(
			'Offline. Messages send when you reconnect. Saved conversations are available on this device.'
		)
	).toBeHidden();
});

test('the reflow check catches content wider than the screen', async ({ page, context }) => {
	await mockApi(context);
	await page.goto('/chat');
	await expect(page.getByText('Say hi to your agent.')).toBeVisible();
	await page.setViewportSize({ width: 320, height: 800 });
	expect(await horizontalOverflow(page)).toEqual([]);
	await page.evaluate(() => {
		const wide = document.createElement('div');
		wide.id = 'too-wide';
		wide.style.width = '600px';
		wide.style.height = '10px';
		document.querySelector('main')!.append(wide);
	});
	// The document never grows, which is why a documentElement check alone proves nothing here.
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		)
	).toBeLessThanOrEqual(0);
	const offenders = await horizontalOverflow(page);
	expect(offenders.some((o) => o.startsWith('div#too-wide'))).toBe(true);
	// The scroller clips sideways, so a missed wrap is cut off instead of scrolling the whole chat.
	expect(offenders.some((o) => o.startsWith('main') && o.includes('scrolls'))).toBe(false);
	expect(
		await page.evaluate(() => getComputedStyle(document.querySelector('main')!).overflowX)
	).toBe('hidden');
});

for (const colorScheme of ['light', 'dark'] as const) {
	for (const path of ['/chat', '/settings']) {
		test(`${path} passes axe, 48px targets and reflow in ${colorScheme}`, async ({
			page,
			context
		}) => {
			await page.emulateMedia({ colorScheme });
			await mockApi(context);
			await stubPush(page);
			await page.goto(path);
			if (path === '/settings') {
				await expect(page.getByTestId('login')).toBeVisible();
				await expect(page.getByTestId('owner-name')).toHaveText('Sam');
			} else await expect(page.getByText('Say hi to your agent.')).toBeVisible();

			expect(await axe(page)).toEqual([]);
			expect(await smallTargets(page)).toEqual([]);

			for (const width of [412, 320]) {
				await page.setViewportSize({ width, height: 800 });
				expect(await horizontalOverflow(page), `overflow at ${width}px`).toEqual([]);
			}
		});
	}
}

test('settings saves and clears the name the agent calls you', async ({ page, context }) => {
	const { calls } = await mockApi(context);
	await stubPush(page);
	await page.goto('/settings');
	await page.getByRole('button', { name: 'Edit your name' }).click();
	const field = page.getByLabel('Your name', { exact: true });
	await expect(field).toHaveValue('Sam');
	const save = page.getByRole('button', { name: 'Save name' });
	await expect(save).toBeDisabled();

	await field.fill('  Alex ');
	await save.click();
	await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
	const posts = () =>
		calls.filter((c) => c.method === 'POST' && c.path === '/api/settings/owner-name');
	expect(JSON.parse(posts().at(-1)!.body!)).toEqual({ name: 'Alex' });
	expect(posts().at(-1)!.contentType).toBe('application/json');
	await expect(field).toHaveCount(0);
	await expect(page.getByTestId('owner-name')).toHaveText('Alex');
	await expect(page.getByRole('button', { name: 'Edit your name' })).toBeFocused();
	await page.getByRole('button', { name: 'Edit your name' }).click();
	await expect(field).toHaveValue('Alex');
	await expect(save).toBeDisabled();

	await page.getByRole('button', { name: 'Clear name' }).click();
	await expect(page.getByText('Cleared. The agent calls you “the user”.')).toBeVisible();
	expect(JSON.parse(posts().at(-1)!.body!)).toEqual({ name: null });
	await expect(field).toHaveCount(0);
	await expect(page.getByTestId('owner-name')).toHaveText('Not set');
	await expect(page.getByRole('button', { name: 'Clear name' })).toHaveCount(0);
});

test('name editing is disclosed on request and cancel does not save', async ({ page, context }) => {
	const { calls } = await mockApi(context);
	await stubPush(page);
	await page.goto('/settings');
	await expect(page.getByTestId('owner-name')).toHaveText('Sam');
	await expect(page.getByRole('textbox', { name: 'Your name' })).toHaveCount(0);
	const edit = page.getByRole('button', { name: 'Edit your name' });
	await edit.click();
	const field = page.getByRole('textbox', { name: 'Your name' });
	await expect(field).toBeFocused();
	await field.fill('Uncommitted name');
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(edit).toBeFocused();
	await expect(page.getByTestId('owner-name')).toHaveText('Sam');
	expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/settings/owner-name')).toEqual(
		[]
	);
	await edit.click();
	await expect(field).toHaveValue('Sam');
	for (const width of [412, 320]) {
		await page.setViewportSize({ width, height: 800 });
		expect(await horizontalOverflow(page)).toEqual([]);
		expect(await smallTargets(page)).toEqual([]);
	}
	expect(await axe(page)).toEqual([]);
});

for (const action of ['Save name', 'Clear name']) {
	test(`a delayed ${action} preserves a newer draft`, async ({ page, context }) => {
		await mockApi(context);
		await stubPush(page);
		let release!: () => void;
		const responseReady = new Promise<void>((resolve) => {
			release = resolve;
		});
		await context.route('**/api/settings/owner-name', async (route) => {
			if (route.request().method() !== 'POST') return route.fallback();
			const { name } = route.request().postDataJSON();
			await responseReady;
			await route.fulfill({ json: { name } });
		});
		await page.goto('/settings');
		await page.getByRole('button', { name: 'Edit your name' }).click();
		const field = page.getByRole('textbox', { name: 'Your name' });
		await field.fill('First draft');
		await page.getByRole('button', { name: action, exact: true }).click();
		await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled();
		await field.fill('Newer draft');
		release();
		await expect(page.getByRole('button', { name: 'Save name', exact: true })).toBeEnabled();
		await expect(field).toHaveValue('Newer draft');
		await expect(page.getByRole('button', { name: 'Edit your name' })).toHaveCount(0);
	});
}

test('a refused name keeps what you typed and says why', async ({ page, context }) => {
	await mockApi(context, { nameStatus: 422 });
	await stubPush(page);
	await page.goto('/settings');
	await page.getByRole('button', { name: 'Edit your name' }).click();
	const field = page.getByLabel('Your name', { exact: true });
	await expect(field).toHaveValue('Sam');
	await field.fill('Alex');
	await page.getByRole('button', { name: 'Save name' }).click();
	await expect(page.getByRole('alert')).toHaveText(
		"Couldn't save your name. Use one line, without control characters."
	);
	await expect(field).toHaveValue('Alex');
	await expect(field).toHaveAttribute('aria-invalid', 'true');
	await expect(page.getByRole('button', { name: 'Save name' })).toBeEnabled();
});

test('a failed clear keeps the saved name in the field', async ({ page, context }) => {
	await mockApi(context, { nameStatus: 500 });
	await stubPush(page);
	await page.goto('/settings');
	await page.getByRole('button', { name: 'Edit your name' }).click();
	const field = page.getByLabel('Your name', { exact: true });
	await expect(field).toHaveValue('Sam');
	await page.getByRole('button', { name: 'Clear name' }).click();
	await expect(page.getByRole('alert')).toContainText("Couldn't save your name.");
	await expect(field).toHaveValue('Sam');
	await expect(page.getByRole('button', { name: 'Clear name' })).toBeVisible();
});

test('the theme choices move with the arrow keys', async ({ page, context }) => {
	await mockApi(context);
	await stubPush(page);
	await page.goto('/settings');
	const group = page.getByRole('radiogroup', { name: 'Appearance' });
	const system = group.getByRole('radio', { name: 'System' });
	const light = group.getByRole('radio', { name: 'Light' });
	// axe reads the name only through aria-labelledby, not the wrapping FieldLabel.
	await expect(system).toHaveAttribute('aria-labelledby', /.+/);
	await expect(system).toHaveAttribute('tabindex', '0');
	await expect(light).toHaveAttribute('tabindex', '-1');
	await system.focus();
	await page.keyboard.press('ArrowRight');
	await expect(light).toBeFocused();
	await expect(light).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('ArrowLeft');
	await expect(group.getByRole('radio', { name: 'Dark' })).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(system).toBeFocused();
	await expect(system).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('ArrowUp');
	await expect(group.getByRole('radio', { name: 'Dark' })).toBeFocused();
	await expect(group.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
});

test('the precached shell opens while offline', async ({ page, context }) => {
	await mockApi(context);
	await page.goto('/');
	await controlled(page);
	await context.setOffline(true);
	await page.goto('/settings');
	await expect(page.getByRole('heading', { name: 'App settings' })).toBeVisible();
	await expect(page.getByText(/You're offline/)).toBeVisible();
});

test('a 502 from the proxy during a restart still opens the cached shell', async ({
	page,
	context
}) => {
	await mockApi(context);
	await page.goto('/');
	await controlled(page);
	await context.route('**/settings', (route) =>
		route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad gateway' })
	);
	await page.goto('/settings');
	await expect(page.getByRole('heading', { name: 'App settings' })).toBeVisible();
	await expect(page.getByTestId('login')).toHaveText('drk@example.com');
});

test('a 403 page from the proxy is shown as is', async ({ page, context }) => {
	await mockApi(context);
	await page.goto('/');
	await controlled(page);
	await context.route('**/settings', (route) =>
		route.fulfill({ status: 403, contentType: 'text/plain', body: 'Not the owner' })
	);
	await page.goto('/settings');
	await expect(page.getByText('Not the owner')).toBeVisible();
});

async function pushChannel(page: Page, context: BrowserContext) {
	const cdp = await context.newCDPSession(page);
	const registered = new Promise<string>((resolve) => {
		cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
			const reg = registrations.find((r) => !r.isDeleted);
			if (reg) resolve(reg.registrationId);
		});
	});
	await cdp.send('ServiceWorker.enable');
	const registrationId = await registered;
	// Chromium opens a context's notification store lazily, and a showNotification racing another read or
	// write during that first open can be dropped even though its promise resolves. Open it first.
	await page.evaluate(async () => (await navigator.serviceWorker.ready).getNotifications());
	const origin = new URL(page.url()).origin;
	return (payload: unknown) =>
		cdp.send('ServiceWorker.deliverPushMessage', {
			origin,
			registrationId,
			data: JSON.stringify(payload)
		});
}

const shownNotifications = (page: Page) =>
	page.evaluate(async () => {
		const reg = await navigator.serviceWorker.ready;
		return (await reg.getNotifications()).map((n) => ({
			title: n.title,
			body: n.body,
			tag: n.tag,
			data: n.data,
			silent: n.silent,
			requireInteraction: n.requireInteraction,
			renotify: n.renotify
		}));
	});

test('a push message shows a notification from the service worker', async ({ page, context }) => {
	await context.grantPermissions(['notifications']);
	await mockApi(context);
	await page.goto('/');
	await controlled(page);
	const push = await pushChannel(page, context);
	await push({ title: 'Run failed', body: 'Nightly sync', url: '/settings', tag: 'r1' });
	await expect
		.poll(async () =>
			(await shownNotifications(page)).map(({ title, body, tag, data }) => ({
				title,
				body,
				tag,
				data
			}))
		)
		.toEqual([
			{ title: 'Run failed', body: 'Nightly sync', tag: 'r1', data: { url: '/settings' } }
		]);
});

test('a push honours its flags and never keeps a cross-origin url', async ({ page, context }) => {
	await context.grantPermissions(['notifications']);
	await mockApi(context);
	await page.goto('/settings');
	await controlled(page);
	const push = await pushChannel(page, context);
	await push({
		title: 'Approval needed',
		body: 'run bash',
		url: 'https://evil.example/?approve=n1',
		tag: 'approval:n1',
		requireInteraction: true,
		renotify: true
	});
	// Show the first before sending the second, so the two notification store writes never overlap.
	await expect
		.poll(async () => (await shownNotifications(page)).map((n) => n.tag))
		.toEqual(['approval:n1']);
	await push({
		title: 'Reply',
		body: 'night',
		url: '/api/chat/stream',
		tag: 'quiet',
		silent: true
	});
	await expect
		.poll(async () => (await shownNotifications(page)).sort((a, b) => a.tag.localeCompare(b.tag)))
		.toEqual([
			{
				title: 'Approval needed',
				body: 'run bash',
				tag: 'approval:n1',
				data: { url: '/' },
				silent: false,
				requireInteraction: true,
				renotify: true
			},
			{
				title: 'Reply',
				body: 'night',
				tag: 'quiet',
				data: { url: '/' },
				silent: true,
				requireInteraction: false,
				renotify: false
			}
		]);
});

test('opening the chat closes the chat notification and leaves others', async ({
	page,
	context
}) => {
	await context.grantPermissions(['notifications']);
	await mockApi(context);
	await page.goto('/settings');
	await controlled(page);
	const push = await pushChannel(page, context);
	await push({ title: 'sushii-agent', body: 'done', url: '/', tag: 'chat' });
	await push({ title: 'Other', body: 'x', url: '/', tag: 'other' });
	await expect.poll(async () => (await shownNotifications(page)).length).toBe(2);
	await page.goto('/chat');
	await expect
		.poll(async () => (await shownNotifications(page)).map((n) => n.tag))
		.toEqual(['other']);
});

test('opening a pushed approval on Home closes its notification and leaves others', async ({
	page,
	context
}) => {
	await context.grantPermissions(['notifications']);
	await mockApi(context);
	await context.addInitScript(() => {
		(window as unknown as { __sse: { hello: { pending: unknown } } }).__sse.hello.pending = {
			approvals: [
				{
					seq: 3,
					at: new Date().toISOString(),
					nonce: 'n1',
					view: { tool: 'send_email', agentId: 'main', agentName: 'sushii-agent', fields: [] }
				}
			],
			asks: []
		};
	});
	await page.goto('/settings');
	await controlled(page);
	const push = await pushChannel(page, context);
	await push({
		title: 'Approval needed',
		body: 'send_email',
		url: '/?approve=n1',
		tag: 'approval:n1'
	});
	await push({ title: 'Other', body: 'x', url: '/', tag: 'other' });
	await expect.poll(async () => (await shownNotifications(page)).length).toBe(2);
	await page.goto('/?approve=n1');
	await expect(page.getByRole('dialog', { name: 'Approval needed' })).toBeVisible();
	await expect
		.poll(async () => (await shownNotifications(page)).map((n) => n.tag))
		.toEqual(['other']);
});

test('settings from the chat goes back to the chat', async ({ page, context }) => {
	await mockApi(context);
	await stubPush(page);
	await page.goto('/chat');
	await (await openDrawer(page)).getByRole('link', { name: 'App settings' }).click();
	await expect(page).toHaveURL(/\/settings$/);
	await page.goBack();
	await expect(page).toHaveURL(/\/chat$/);
	await expect(page.getByText('Say hi to your agent.')).toBeVisible();
});

test('opening settings directly throws nothing', async ({ page, context }) => {
	await mockApi(context);
	await stubPush(page);
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto('/settings');
	await expect(page.getByRole('heading', { name: 'App settings', level: 1 })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Menu/ })).toBeVisible();
	expect(errors).toEqual([]);
});

test('the app runs under enforced Trusted Types with only its own policies', async ({
	page,
	context
}) => {
	await mockApi(context);
	await stubPush(page);
	const res = await page.goto('/chat');
	expect(res?.headers()['content-security-policy']).toContain("require-trusted-types-for 'script'");
	await expect(page.getByText('Say hi to your agent.')).toBeVisible();
	await page.evaluate(() => navigator.serviceWorker.ready);
	const probe = await page.evaluate(() => {
		const tt = (
			window as unknown as { trustedTypes: { createPolicy(n: string, r: object): unknown } }
		).trustedTypes;
		const tryIt = (f: () => unknown) => {
			try {
				f();
				return 'allowed';
			} catch {
				return 'blocked';
			}
		};
		return {
			innerHTML: tryIt(() => (document.createElement('div').innerHTML = '<b>x</b>')),
			policy: tryIt(() => tt.createPolicy('evil', { createHTML: (s: string) => s }))
		};
	});
	expect(probe).toEqual({ innerHTML: 'blocked', policy: 'blocked' });
	// The probe's own violations are expected; anything after it is not.
	ttErrors.get(page)?.splice(0);
	await (await openDrawer(page)).getByRole('link', { name: 'App settings' }).click();
	await expect(page.getByTestId('login')).toHaveText('drk@example.com');
});

for (const outcome of ['success', 'failure'] as const) {
	test(`an SSE announcement prepares the web update without polling: ${outcome}`, async ({
		page,
		context
	}) => {
		const api = await mockApi(context);
		await page.addInitScript(() => {
			const original = window.fetch;
			const encoder = new TextEncoder();
			Object.assign(window, { announceUpdate: null, finishUpdate: null, updateChecks: 0 });
			window.fetch = async (input, init) => {
				if (String(input).startsWith('/api/chat/stream')) {
					return new Response(
						new ReadableStream({
							start(controller) {
								const emit = (event: string, data: unknown) =>
									controller.enqueue(
										encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
									);
								emit('hello', {
									headSeq: 0,
									workspace: 'online',
									openTurns: [],
									pending: { approvals: [], asks: [] }
								});
								Object.assign(window, {
									announceUpdate: () => emit('app_update', { web: 'new-build', android: null })
								});
							}
						}),
						{ headers: { 'content-type': 'text/event-stream' } }
					);
				}
				return original(input, init);
			};
			const worker = Object.assign(new EventTarget(), { state: 'installing', postMessage() {} });
			const reg = Object.assign(new EventTarget(), {
				waiting: null as typeof worker | null,
				installing: null as typeof worker | null,
				pushManager: { getSubscription: async () => null },
				update: async () => {
					reg.installing = worker;
					Object.assign(window, { updateChecks: 1 });
				}
			});
			Object.defineProperty(navigator.serviceWorker, 'controller', { value: {} });
			navigator.serviceWorker.register = async () => reg as unknown as ServiceWorkerRegistration;
			navigator.serviceWorker.getRegistration = async () =>
				reg as unknown as ServiceWorkerRegistration;
			Object.assign(window, {
				finishUpdate: (failed: boolean) => {
					worker.state = failed ? 'redundant' : 'installed';
					reg.waiting = failed ? null : worker;
					reg.installing = null;
					worker.dispatchEvent(new Event('statechange'));
				}
			});
		});
		await page.goto('/settings');
		await expect(page.getByTestId('login')).toBeVisible();
		await expect(page.getByLabel('App updates')).toHaveCount(0);
		await expect
			.poll(() =>
				page.evaluate(
					() => typeof (window as unknown as { announceUpdate: unknown }).announceUpdate
				)
			)
			.toBe('function');
		const checks = api.calls.filter((call) => call.path === '/api/updates').length;
		await page.evaluate(() => (window as unknown as { announceUpdate(): void }).announceUpdate());
		await expect(page.getByText('Downloading web update…')).toBeVisible();
		await expect(
			page.getByLabel('App updates').getByRole('button', { name: 'Reload' })
		).toHaveCount(0);
		await page.evaluate(
			(failed) =>
				(window as unknown as { finishUpdate(failed: boolean): void }).finishUpdate(failed),
			outcome === 'failure'
		);
		await expect(
			page
				.getByLabel('App updates')
				.getByRole('button', { name: outcome === 'success' ? 'Reload' : 'Retry' })
		).toBeVisible();
		expect(api.calls.filter((call) => call.path === '/api/updates').length).toBe(checks);
		await horizontalOverflow(page);
	});
}

for (const supported of [true, false]) {
	test(`Android release notice uses ${supported ? 'native installer' : 'first-upgrade download'}`, async ({
		page,
		context
	}) => {
		await mockApi(context);
		await page.addInitScript((supported) => {
			let installs = 0;
			Object.assign(window, {
				androidBridge: {},
				installs: 0,
				Capacitor: {
					PluginHeaders: supported
						? [
								{
									name: 'AppUpdates',
									methods: ['status', 'install'].map((name) => ({ name, rtype: 'promise' }))
								}
							]
						: [],
					nativePromise: async (plugin: string, method: string) => {
						if (plugin !== 'AppUpdates') throw new Error('Unavailable');
						if (method === 'status') return { versionCode: 1, versionName: '1.0' };
						Object.assign(window, { installs: ++installs });
						return installs === 1 ? { permissionRequired: true } : undefined;
					}
				}
			});
		}, supported);
		await context.route('**/api/updates', (route) =>
			route.fulfill({
				json: {
					web: null,
					android: {
						versionCode: 2,
						versionName: '1.0.1',
						sha256: 'a'.repeat(64),
						url: 'https://github.com/sushiibot/omakase/releases/download/android-2/omakase.apk'
					}
				}
			})
		);
		await page.goto('/settings');
		await expect(page.getByText('Android 1.0.1 available')).toBeVisible();
		if (supported) {
			await page.getByRole('button', { name: 'Install update' }).click();
			await expect(page.getByText('Allow installs, then tap Install update again.')).toBeVisible();
			expect(await page.evaluate(() => (window as unknown as { installs: number }).installs)).toBe(
				1
			);
			// Android's successful call.resolve() has no data payload.
			await page.getByRole('button', { name: 'Install update' }).click();
			await expect(page.getByText('Android 1.0.1 available')).toBeVisible();
			await expect(page.getByText('Allow installs, then tap Install update again.')).toHaveCount(0);
			expect(await page.evaluate(() => (window as unknown as { installs: number }).installs)).toBe(
				2
			);
		} else {
			await expect(page.getByRole('link', { name: 'Download APK' })).toHaveAttribute(
				'href',
				/android-2\/omakase.apk$/
			);
		}
		await horizontalOverflow(page);
	});
}
