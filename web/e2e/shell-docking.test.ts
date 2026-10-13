import { expect, test, type Page } from '@playwright/test';
import { fixtureApp } from './helpers';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Channel navigation' });
const panel = (page: Page) => page.getByRole('complementary', { name: 'Conversation tasks' });
const returnTarget = (page: Page) =>
	page.getByRole('button', { name: 'Return to conversation', exact: true });
const focusedIn = (page: Page, selector: string) =>
	page.evaluate((s) => !!document.activeElement?.closest(s), selector);

test('at 900px the nav docks and the inspector slides over the chat', async ({ page, context }) => {
	await fixtureApp(context);
	await page.setViewportSize({ width: 900, height: 860 });
	await page.goto('/chat');
	await expect(nav(page)).toBeVisible();
	await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Toggle Sidebar' })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Menu/ })).toHaveCount(0);

	await page.getByRole('button', { name: 'Tasks, 3 open' }).click();
	await expect(panel(page)).toBeVisible();
	await expect(returnTarget(page)).toBeVisible();
	await expect(page.locator('[data-chat-surface] > .chat-content')).toHaveAttribute(
		'aria-hidden',
		'true'
	);
	await expect(page.locator('[data-channel-navigation] [inert]')).toHaveCount(1);
	await expect.poll(() => focusedIn(page, '[data-workspace-inspector]')).toBe(true);

	await returnTarget(page).click();
	await expect(panel(page)).toBeHidden();
	await expect(page.locator('[data-channel-navigation] [inert]')).toHaveCount(0);
	await expect(nav(page).getByRole('link', { name: 'Main', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
});

test('at 1280px nav and inspector both dock beside the chat', async ({ page, context }) => {
	await fixtureApp(context);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/chat');
	await page.getByRole('button', { name: 'Tasks, 3 open' }).click();
	await expect(panel(page)).toBeVisible();
	await expect(returnTarget(page)).toHaveCount(0);
	await expect(page.locator('[data-chat-surface] > .chat-content')).not.toHaveAttribute(
		'aria-hidden',
		'true'
	);
	const box = await panel(page).boundingBox();
	expect(box!.x + box!.width).toBeCloseTo(1280, 0);
	await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
	await panel(page).getByRole('button', { name: 'Close side panel' }).click();
	await expect(panel(page)).toBeHidden();
	await expect(page.locator('[data-workspace-inspector]')).toHaveAttribute('inert', '');
});

test('Cmd+B and the header trigger collapse the sidebar, and the choice survives a reload', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/chat');
	const sidebar = page.locator('[data-slot="sidebar"]');
	await expect(sidebar).toHaveAttribute('data-state', 'expanded');
	await page.getByRole('textbox', { name: 'Message', exact: true }).click();
	await page.keyboard.press('ControlOrMeta+b');
	await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
	await expect(page.locator('[data-channel-navigation] [inert]')).toHaveCount(1);

	await page.reload();
	await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
	await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
	await expect(sidebar).toHaveAttribute('data-state', 'expanded');
	await expect(nav(page).getByRole('link', { name: 'Main', exact: true })).toBeVisible();

	await page.reload();
	await expect(sidebar).toHaveAttribute('data-state', 'expanded');
});

test('resizing across both breakpoints keeps nav state and moves focus out of the inert chat', async ({
	page,
	context
}) => {
	await fixtureApp(context);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/chat');
	await nav(page).getByRole('button', { name: 'Find and filter channels' }).click();
	const search = (scope: ReturnType<typeof nav>) =>
		scope.getByRole('textbox', { name: 'Find channels by name or preview' });
	await search(nav(page)).fill('Couch');
	await expect(nav(page).getByRole('link', { name: /Couch delivery/ })).toBeVisible();

	await page.getByRole('button', { name: 'Tasks, 3 open' }).click();
	await expect(panel(page)).toBeVisible();
	await page.getByRole('button', { name: /^Tasks, 3 open/ }).focus();

	await page.setViewportSize({ width: 900, height: 860 });
	await expect(returnTarget(page)).toBeVisible();
	await expect.poll(() => focusedIn(page, '[data-workspace-inspector]')).toBe(true);
	await expect(search(nav(page))).toHaveValue('Couch');
	await returnTarget(page).click();

	await page.setViewportSize({ width: 412, height: 860 });
	await expect(nav(page)).toHaveCount(0);
	await page.getByRole('button', { name: /^Menu/ }).click();
	const menu = page.getByRole('dialog', { name: 'Menu' });
	await expect(search(menu)).toHaveValue('Couch');
	await expect(menu.getByRole('link', { name: /Couch delivery/ })).toBeVisible();

	await page.setViewportSize({ width: 1280, height: 900 });
	await expect(menu).toHaveCount(0);
	await expect(search(nav(page))).toHaveValue('Couch');
	await expect(nav(page).getByRole('link', { name: /Couch delivery/ })).toBeVisible();
});
