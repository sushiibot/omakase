import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { channelFixture } from '../src/lib/features/channels/fixtures';
import { axe, horizontalOverflow, smallTargets, stubStream, fixtureApp } from './helpers';

const LIVE_NAV = ['Channels', 'Tasks', 'Activity', 'Workspace', 'Settings'];

/** Live navigation never depends on /api/me; overrides enable only fixture previews. */
async function server(
	context: BrowserContext,
	opts: { override?: string; me?: 'hang'; main?: 'running' | 'idle' } = {}
) {
	await stubStream(context);
	await context.addInitScript((override) => {
		if (override) localStorage.setItem('features:override', override);
	}, opts.override ?? '');
	await context.route('**/api/**', (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === '/api/me') {
			if (opts.me === 'hang') return;
			return route.fulfill({ json: { login: 'drk@example.com' } });
		}
		if (path === '/api/chat/history') return route.fulfill({ json: { items: [], before: null } });
		if (path === '/api/channels' && opts.main)
			return route.fulfill({
				json: {
					channels: [channelFixture('main', 'Main', { state: opts.main })],
					archiveAfterDays: 7
				}
			});
		return route.fulfill({ status: 404, body: 'Not found' });
	});
}

/** Opens the phone drawer from the current screen's header. */
async function drawer(page: Page) {
	await page.getByRole('button', { name: /^Menu/ }).click();
	const menu = page.getByRole('dialog', { name: 'Menu' });
	await expect(menu).toBeVisible();
	return menu;
}

test('the app opens on Home and all live screens appear in the drawer by default', async ({
	page,
	context
}) => {
	await server(context, { main: 'idle' });
	await page.goto('/');
	await expect(page).toHaveURL(/\/assistant$/);
	await page.goto('/chat');
	const menu = await drawer(page);
	await expect(
		menu.getByRole('navigation', { name: 'Home' }).getByRole('link', { name: 'Home' })
	).toBeVisible();
	for (const label of LIVE_NAV)
		await expect(menu.getByRole('link', { name: label, exact: true })).toBeVisible();
	for (const label of ['Memory', 'History'])
		await expect(menu.getByRole('link', { name: label, exact: true })).toHaveCount(0);
	await expect(menu.getByRole('link', { name: 'Main', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
});

test('the app opens on the chat while it is working', async ({ page, context }) => {
	await server(context, { main: 'running' });
	await page.goto('/');
	await expect(page).toHaveURL(/\/chat$/);
});

test('Workspace groups secondary destinations and keeps fixture previews gated', async ({
	page,
	context
}) => {
	await server(context, { override: 'all' });
	await page.goto('/workspace');
	await expect(page.getByRole('heading', { name: 'Workspace', level: 1 })).toBeVisible();
	const content = page.locator('main');
	for (const label of ['Memory', 'History', 'Briefing', 'Skills', 'Schedules', 'Browser'])
		await expect(content.getByRole('link', { name: new RegExp(`^${label}`) })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Development previews' })).toBeVisible();
	const menu = await drawer(page);
	for (const label of ['Skills', 'Schedules', 'Browser', 'Briefing'])
		await expect(menu.getByRole('link', { name: label, exact: true })).toHaveCount(0);
	await page.keyboard.press('Escape');
	await page.setViewportSize({ width: 1280, height: 800 });
	await expect(page.getByRole('button', { name: /^Menu/ })).toBeHidden();
	await expect(page.getByRole('heading', { name: 'Workspace', level: 1 })).toBeVisible();
});

test('Workspace contains live information without enabling fixture previews', async ({
	page,
	context
}) => {
	await server(context);
	await page.goto('/workspace');
	const content = page.locator('main');
	for (const label of ['Memory', 'History'])
		await expect(content.getByRole('link', { name: new RegExp(`^${label}`) })).toBeVisible();
	for (const label of ['Skills', 'Schedules', 'Browser', 'Briefing'])
		await expect(content.getByRole('link', { name: new RegExp(`^${label}`) })).toHaveCount(0);
	await expect(page.getByRole('region', { name: 'Development previews' })).toHaveCount(0);
});

test('picking from the drawer closes it; back from there returns to the chat, then the drawer closes before leaving', async ({
	page,
	context
}) => {
	await server(context);
	await page.goto('/chat');
	await (await drawer(page)).getByRole('link', { name: 'Activity' }).click();
	await expect(page).toHaveURL(/\/runs$/);
	await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
	await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden();
	await (await drawer(page)).getByRole('link', { name: 'Workspace' }).click();
	await expect(page).toHaveURL(/\/workspace$/);
	await expect(page.getByRole('heading', { name: 'Workspace', level: 1 })).toBeVisible();
	await page
		.locator('main')
		.getByRole('link', { name: /^History/ })
		.click();
	await expect(page).toHaveURL(/\/history$/);
	await page.goBack();
	await expect(page).toHaveURL(/\/workspace$/);
	await expect(page.getByRole('heading', { name: 'Workspace', level: 1 })).toBeVisible();
	await page.goBack();
	await expect(page).toHaveURL(/\/runs$/);
	await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
	await page.goBack();
	await expect(page).toHaveURL(/\/chat$/);
	await expect(page.getByRole('heading', { name: 'Sushii', level: 1 })).toBeVisible();
	await drawer(page);
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden();
	await expect(page).toHaveURL(/\/chat$/);
	await expect(page.getByRole('heading', { name: 'Sushii', level: 1 })).toBeVisible();
});

test('an unknown address sends you to the chat', async ({ page, context }) => {
	await server(context);
	await page.goto('/no-such-screen');
	await expect(page).toHaveURL(/\/chat$/);
});

test('drawer navigation keeps the old screen covered until the destination mounts', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await page.goto('/chat');
	await expect(page.getByRole('heading', { name: 'Sushii', level: 1 })).toBeVisible();
	let release!: () => void;
	let requested!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const loading = new Promise<void>((resolve) => (requested = resolve));
	await context.route('**/_app/immutable/nodes/*.js', async (route) => {
		requested();
		await gate;
		await route.continue();
	});
	const menu = await drawer(page);
	await menu.evaluate((element) => {
		const observer = new MutationObserver(() => {
			if (element.getAttribute('aria-hidden') !== 'true') return;
			element.setAttribute(
				'data-closed-over',
				document.querySelector('header h1')?.textContent ?? ''
			);
			observer.disconnect();
		});
		observer.observe(element, { attributes: true, attributeFilter: ['aria-hidden'] });
	});
	try {
		await menu.getByRole('link', { name: 'Activity', exact: true }).click();
		await loading;
		await expect(menu).toBeVisible();
		await expect(page).toHaveURL(/\/chat$/);
		release();
		await expect(page).toHaveURL(/\/runs$/);
		await expect(menu).toBeHidden();
		await expect(page.getByRole('dialog', { name: 'Menu', includeHidden: true })).toHaveAttribute(
			'data-closed-over',
			'Activity'
		);
	} finally {
		release();
	}
});

test('choosing the current drawer destination dismisses it without navigating', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await page.goto('/runs');
	const menu = await drawer(page);
	await page.evaluate(() => {
		window.addEventListener(
			'click',
			(event) => {
				document.documentElement.dataset.dismissPrevented = String(event.defaultPrevented);
			},
			{ once: true }
		);
	});
	await menu.getByRole('link', { name: 'Activity', exact: true }).click();
	await expect(page.locator('html')).toHaveAttribute('data-dismiss-prevented', 'true');
	await expect(menu).toBeHidden();
	await expect(page).toHaveURL(/\/runs$/);
});

test('a live deep link renders while /api/me is unavailable', async ({ page, context }) => {
	await server(context, { me: 'hang' });
	await page.goto('/runs');
	await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
	await page.waitForTimeout(500);
	await expect(page).toHaveURL(/\/runs$/);
});

for (const [path, api] of [
	['/skills/x/versions', /^\/api\/skills/],
	['/schedules/x', /^\/api\/schedules/],
	// Chat now polls the live preview status; the standalone screen's fixture APIs stay gated.
	['/browser', /^\/api\/browser(?:$|\/(?!status(?:$|\/)|connect(?:$|\/)))/],
	['/briefing', /^\/api\/briefing/]
] as const) {
	test(`${path} without its fixture preview goes to chat without requesting preview data`, async ({
		page,
		context
	}) => {
		await server(context);
		const asked: string[] = [];
		page.on('request', (req) => {
			const p = new URL(req.url()).pathname;
			if (api.test(p)) asked.push(p);
		});
		await page.goto(path);
		await expect(page).toHaveURL(/\/chat$/);
		await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
		expect(asked).toEqual([]);
	});
}

for (const colorScheme of ['light', 'dark'] as const) {
	test(`the open drawer passes axe, 48px targets and reflow in ${colorScheme}`, async ({
		page,
		context
	}) => {
		await page.emulateMedia({ colorScheme });
		await server(context, { override: 'all' });
		await page.goto('/chat');
		await drawer(page);
		expect(await axe(page)).toEqual([]);
		expect(await smallTargets(page)).toEqual([]);
		for (const width of [412, 320]) {
			await page.setViewportSize({ width, height: 800 });
			expect(await horizontalOverflow(page), `at ${width}px`).toEqual([]);
		}
	});
}

test('main chat and inbox links share the Channels drawer destination', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await page.goto('/chat');
	const menu = await drawer(page);
	await expect(menu.getByRole('link', { name: 'Main', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await menu.getByRole('link', { name: /^Channels/ }).click();
	await expect(page).toHaveURL(/\/chats$/);
	await page.getByRole('link', { name: /^Main chat/ }).click();
	await expect(page).toHaveURL(/\/chat$/);
	await page.goBack();
	await expect(page).toHaveURL(/\/chats$/);
});

test('widening past the sidebar breakpoint closes an open drawer, so the page stays usable', async ({
	page,
	context
}) => {
	await server(context);
	await page.goto('/chat');
	await drawer(page);
	await page.setViewportSize({ width: 1280, height: 800 });
	await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden();
	await page
		.locator('[data-channel-navigation]')
		.first()
		.getByRole('link', { name: 'Activity' })
		.click();
	await expect(page).toHaveURL(/\/runs$/);
});

test('Memory and thread deep links load without a fixture override', async ({ page, context }) => {
	await fixtureApp(context, { override: '' });
	await page.goto('/memory');
	await expect(page.getByRole('heading', { name: 'Memory', level: 1 })).toBeVisible();
	await expect(page.getByRole('link', { name: /MEMORY.md/ })).toBeVisible();
	await page.goto('/chats/oct-trip');
	await expect(page.getByRole('heading', { name: 'October trip', level: 1 })).toBeVisible();
	await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
});
