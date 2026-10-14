import { expect, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { FixtureScenario } from '../src/lib/core/fixtures';
import { fakeBackend } from './fake-backend';
import { fixtureRoutes, type FixtureFeature, type FixtureRoutes } from './fixture-routes';

/**
 * Controls whose hit box is too small. A coarse-pointer `::after` extension counts only as far as
 * `elementFromPoint` still resolves to the control, so a neighbour or a clipping ancestor shrinks
 * it. Points outside the viewport, and controls under an overlay or scrolled partly out of view,
 * fall back to geometry.
 */
export async function smallTargets(page: Page) {
	return page.$$eval(
		'a, button, [role=button], [role=switch], [role=radio], input, select, textarea, summary',
		(els) => {
			const control =
				'a, button, [role=button], [role=switch], [role=radio], input, select, textarea, summary, label';
			// A point is lost to a clipping ancestor or to another control. Anything else on top, such as
			// a sticky footer at this scroll position, says nothing about the hit area, so it counts.
			const hitsSelf = (e: Element, x: number, y: number) => {
				if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return true;
				const hit = document.elementFromPoint(x, y);
				if (!hit || hit === e || e.contains(hit)) return true;
				return !(hit.contains(e) || hit.closest(control));
			};
			const px = (v: string) => parseFloat(v) || 0;
			type Side = 'Top' | 'Right' | 'Bottom' | 'Left';
			const sides: [Side, number, number][] = [
				['Top', 0, -1],
				['Right', 1, 0],
				['Bottom', 0, 1],
				['Left', -1, 0]
			];
			const measure = (e: Element) => {
				const r = e.getBoundingClientRect();
				if (r.width === 0) return null;
				const after = getComputedStyle(e, '::after');
				const extended = after.position === 'absolute' && after.content !== 'none';
				const inField =
					!!e.closest('[data-slot=input-group]') ||
					[...(e.parentElement?.querySelectorAll('input') ?? [])].some((input) => {
						const f = input.getBoundingClientRect();
						return f.top <= r.top && f.bottom >= r.bottom && f.left <= r.left && f.right >= r.right;
					});
				// A Button whose hit area is switched off, a sidebar row, an Item in a group or a disclosure
				// trigger is a contiguous row and sizes its own box. All but Button rows are promised 44px on touch.
				const coarse = matchMedia('(any-pointer: coarse)').matches;
				const sidebarRow =
					coarse && ['menu-button', 'group-label'].includes(e.getAttribute('data-sidebar') ?? '');
				const row =
					sidebarRow ||
					(coarse && e.getAttribute('data-slot') === 'button' && after.display === 'none');
				const itemRow =
					coarse && e.getAttribute('data-slot') === 'item' && !!e.closest('[data-slot=item-group]');
				const summaryRow =
					coarse &&
					(e.tagName === 'SUMMARY' || e.getAttribute('data-slot') === 'collapsible-trigger');
				if (!extended || after.display === 'none')
					return {
						w: r.width,
						h: r.height,
						kind: sidebarRow
							? 'sidebar-row'
							: itemRow
								? 'item-row'
								: summaryRow
									? 'summary-row'
									: row
										? 'row'
										: 'box',
						covered: false,
						lost: [] as string[]
					};
				// ::after insets are measured from the padding box; only negative ones grow the target.
				const box = getComputedStyle(e);
				const grow = (side: Side) =>
					Math.max(0, -px(after[side.toLowerCase() as 'top']) - px(box[`border${side}Width`]));
				const cx = r.left + r.width / 2;
				const cy = r.top + r.height / 2;
				const reach: Record<Side, number> = { Top: 0, Right: 0, Bottom: 0, Left: 0 };
				const lost: string[] = [];
				let covered = false;
				const hit = document.elementFromPoint(cx, cy);
				const exposed = !!hit && (hit === e || e.contains(hit));
				// A face partly scrolled out of a scrolling ancestor is clipped by position, not by design.
				let scrolled = false;
				for (let a = e.parentElement; a; a = a.parentElement) {
					if (!/auto|scroll/.test(getComputedStyle(a).overflow)) continue;
					const c = a.getBoundingClientRect();
					if (r.top < c.top || r.bottom > c.bottom || r.left < c.left || r.right > c.right)
						scrolled = true;
				}
				if (exposed && !scrolled) {
					for (const [side, dx, dy] of sides) {
						const ex = dx > 0 ? r.right : dx < 0 ? r.left : cx;
						const ey = dy > 0 ? r.bottom : dy < 0 ? r.top : cy;
						// 2px in: at fractional device scale factors an `::after` can snap 1px past its inset.
						if (!hitsSelf(e, ex - 2 * dx, ey - 2 * dy)) covered = true;
						let n = 0;
						while (n < grow(side) && hitsSelf(e, ex + dx * (n + 0.5), ey + dy * (n + 0.5))) n++;
						reach[side] = n;
						if (n < grow(side)) {
							const by = document.elementFromPoint(ex + dx * (n + 0.5), ey + dy * (n + 0.5));
							const label = by
								? (by.getAttribute('aria-label') ?? by.tagName.toLowerCase())
								: 'edge';
							lost.push(`${side.toLowerCase()} ${n}/${grow(side)} to ${label}`);
						}
					}
				} else for (const [side] of sides) reach[side] = grow(side);
				return {
					w: r.width + reach.Left + reach.Right,
					h: r.height + reach.Top + reach.Bottom,
					kind: inField ? 'in-field' : 'extended',
					covered,
					lost
				};
			};
			return (
				els
					.filter((e) => !e.closest('[inert]') && !(e.tagName === 'A' && e.closest('p')))
					.map((e) => ({ e, m: measure(e) }))
					// A text field is its own wide target at the stock 32px height, and so is a control
					// inside one. A hit area keeps at least 40px in the axis where a neighbour owns the gap
					// and about 48px in the other; contiguous rows are at least 40px tall, sidebar and list Item rows 44px.
					.filter(({ e, m }) => {
						if (!m) return false;
						const field =
							e.tagName === 'TEXTAREA' ||
							e.tagName === 'SELECT' ||
							(e instanceof HTMLInputElement && !['checkbox', 'radio'].includes(e.type));
						if (field) return m.w < 48 || m.h < 32;
						if (m.kind === 'in-field') return m.h < 31.5;
						if (m.covered) return true;
						if (m.kind === 'row') return m.w < 47.5 || m.h < 39.5;
						if (m.kind === 'sidebar-row' || m.kind === 'item-row' || m.kind === 'summary-row')
							return m.w < 47.5 || m.h < 43.5;
						if (m.kind === 'extended')
							return Math.min(m.w, m.h) < 39.5 || Math.max(m.w, m.h) < 46.5;
						return m.w < 47.5 || m.h < 47.5;
					})
					.map(({ e, m }) => {
						const name = e.getAttribute('aria-label') ?? e.textContent?.trim().slice(0, 40);
						return `<${e.tagName.toLowerCase()}> ${name} (${Math.round(m!.w)}x${Math.round(m!.h)}${m!.covered ? ', face covered' : ''}${m!.lost.length ? `; ${m!.lost.join(', ')}` : ''})`;
					})
			);
		}
	);
}

// Embla animates with requestAnimationFrame, outside the Web Animations API.
async function settlePagers(page: Page) {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			)
	);
	await expect
		.poll(() =>
			page.evaluate(() =>
				Array.from(document.querySelectorAll<HTMLElement>('[data-tab-pager]')).every((viewport) => {
					const panel = viewport.querySelector<HTMLElement>(
						'[data-tab-panel][aria-hidden="false"]'
					);
					return (
						!panel ||
						Math.abs(panel.getBoundingClientRect().left - viewport.getBoundingClientRect().left) <
							0.5
					);
				})
			)
		)
		.toBe(true);
}

// The app shell scrolls inside <main>, so the document itself never grows: look at every element
// that sticks out of the viewport and every horizontal scroll container with something to scroll.
export async function horizontalOverflow(page: Page) {
	await settlePagers(page);
	return page.evaluate(() => {
		const width = document.documentElement.clientWidth;
		const describe = (el: Element) =>
			`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${[...el.classList].slice(0, 4).join('.')}`;
		const offenders: string[] = [];
		const scroller = document.scrollingElement;
		if (scroller && scroller.scrollWidth > scroller.clientWidth) offenders.push('document scrolls');
		for (const el of document.body.querySelectorAll('*')) {
			// Pager tracks, inactive panels and scrollable tab labels intentionally sit inside clipped viewports.
			if (
				el.matches('[data-tab-track],[data-task-track]') ||
				el.closest('[inert]') ||
				el.closest('[hidden]') ||
				el.closest('[data-tab-panel][aria-hidden=true]') ||
				el.closest('[data-tab-strip]') ||
				el.closest(
					'[data-shell][data-workspace-pane]:not([data-workspace-pane="chat"]) [data-chat-surface]'
				)
			)
				continue;
			const style = getComputedStyle(el);
			const r = el.getBoundingClientRect();
			// Visually hidden text is clipped to 1px on purpose.
			if (r.width <= 1 && style.overflowX !== 'visible') continue;
			if (r.width > 0 && (r.right > width + 0.5 || r.left < -0.5)) {
				offenders.push(`${describe(el)} spans ${Math.round(r.left)}..${Math.round(r.right)}`);
			}
			const scrollsX = style.overflowX === 'auto' || style.overflowX === 'scroll';
			if (scrollsX && el.scrollWidth > el.clientWidth) {
				offenders.push(`${describe(el)} scrolls ${el.scrollWidth}/${el.clientWidth}`);
			}
		}
		return offenders;
	});
}

export async function axe(page: Page) {
	await settlePagers(page);
	// Scan the settled surface: fade-in opacity temporarily blends text with the scrim.
	// Infinite activity animations keep running and must never block accessibility checks.
	await page.evaluate(async () => {
		await Promise.all(
			document
				.getAnimations()
				.filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
				.map((animation) => animation.finished.catch(() => {}))
		);
	});
	const results = await new AxeBuilder({ page })
		.options({ rules: { 'target-size': { enabled: true } } })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	const ran = [
		...results.passes,
		...results.violations,
		...results.incomplete,
		...results.inapplicable
	];
	expect(ran.some((r) => r.id === 'target-size')).toBe(true);
	return results.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
	);
}

type SseWindow = Window & {
	__sse: {
		hello: {
			headSeq: number;
			workspace: 'online' | 'offline';
			openTurns: unknown[];
			pending: { approvals: unknown[]; asks: unknown[] };
		};
		status: number;
		requests: string[];
		streams: ReadableStreamDefaultController<Uint8Array>[];
	};
};

/**
 * Replaces fetch for selected stream paths with an in-page stream the test writes frames into, since
 * route.fulfill can only answer with a finished body. Context-wide so it survives reloads.
 */
export async function stubStream(context: BrowserContext, paths = ['/api/chat/stream']) {
	await context.addInitScript((paths) => {
		const w = window as unknown as SseWindow;
		w.__sse = {
			hello: {
				headSeq: 0,
				workspace: 'online',
				openTurns: [],
				pending: { approvals: [], asks: [] }
			},
			status: 200,
			requests: [],
			streams: []
		};
		const real = window.fetch.bind(window);
		window.fetch = async (input, init) => {
			const url = new URL(
				typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
				location.href
			);
			if (!paths.includes(url.pathname)) return real(input, init);
			w.__sse.requests.push(url.pathname + url.search);
			if (w.__sse.status !== 200) return new Response('no', { status: w.__sse.status });
			let ctrl!: ReadableStreamDefaultController<Uint8Array>;
			const body = new ReadableStream<Uint8Array>({ start: (c) => void (ctrl = c) });
			w.__sse.streams.push(ctrl);
			init?.signal?.addEventListener('abort', () => {
				w.__sse.streams = w.__sse.streams.filter((c) => c !== ctrl);
				try {
					ctrl.error(new DOMException('aborted', 'AbortError'));
				} catch {
					// Already closed.
				}
			});
			ctrl.enqueue(
				new TextEncoder().encode(`event: hello\ndata: ${JSON.stringify(w.__sse.hello)}\n\n`)
			);
			return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
		};
	}, paths);
}

/** Writes one SSE frame to every open stream; a `seq` makes it a durable event. */
export async function push(page: Page, type: string, data: unknown, seq?: number) {
	await page.evaluate(
		({ type, data, seq }) => {
			const w = window as unknown as SseWindow;
			const id = seq === undefined ? '' : `id: ${seq}\n`;
			const frame = new TextEncoder().encode(
				`event: ${type}\n${id}data: ${JSON.stringify(data)}\n\n`
			);
			for (const c of w.__sse.streams) c.enqueue(frame);
		},
		{ type, data, seq }
	);
}

/** Ends every open stream, as the server does at its 15-minute lifetime. */
export async function endStreams(page: Page) {
	await page.evaluate(() => {
		const w = window as unknown as SseWindow;
		for (const c of w.__sse.streams.splice(0)) c.close();
	});
}

export const streamRequests = (page: Page) =>
	page.evaluate(() => (window as unknown as SseWindow).__sse.requests);

/**
 * The app with fixture previews enabled through the device override, the live routes from the shared
 * fake backend and the fixture screens' routes from their fixture APIs. `fixtures` picks the state
 * a fixture feature serves; the returned handle changes it mid-test.
 */
export async function fixtureApp(
	context: BrowserContext,
	opts: {
		fixtures?: Partial<Record<FixtureFeature, FixtureScenario>>;
		history?: unknown[];
		override?: string;
		streams?: string[];
	} = {}
): Promise<FixtureRoutes> {
	await stubStream(context, opts.streams);
	await context.addInitScript((override) => {
		localStorage.setItem('features:override', override);
		localStorage.setItem('install-hint-dismissed', '1');
	}, opts.override ?? 'all');
	await context.route('**/api/**', (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === '/api/chat/history')
			return route.fulfill({ json: { items: opts.history ?? [], before: null } });
		return route.fulfill({ status: 404, body: 'Not found' });
	});
	await fakeBackend(context);
	return fixtureRoutes(context, opts.fixtures);
}

/** axe, 48px targets and reflow at 412 and 320, in the page's current state. */
export async function checkScreen(page: Page) {
	expect(await axe(page)).toEqual([]);
	expect(await smallTargets(page)).toEqual([]);
	for (const width of [412, 320]) {
		await page.setViewportSize({ width, height: 800 });
		// Code scrolls inside its own box on purpose.
		const overflow = (await horizontalOverflow(page)).filter((o) => !o.startsWith('pre.'));
		expect(overflow, `overflow at ${width}px`).toEqual([]);
	}
	await page.setViewportSize({ width: 412, height: 915 });
}

/** Opens the phone drawer from the current screen's header and returns it. */
export async function openDrawer(page: Page) {
	await page.getByRole('button', { name: /^Menu/ }).click();
	const menu = page.getByRole('dialog', { name: 'Menu' });
	await expect(menu).toBeVisible();
	return menu;
}

/** Open the shared inbox after its records load; slow loads may already have expanded it. */
export async function openSharedInbox(page: Page) {
	const inbox = page.locator('[data-inbox="shared"]');
	const trigger = inbox.locator('[data-slot=collapsible-trigger]');
	await expect(trigger).toContainText(/Inbox · \d+/);
	if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
	await expect(inbox).toHaveAttribute('data-state', 'open');
	await expect(trigger).toHaveAttribute('aria-expanded', 'true');
}

/** Inbox action tests keep disclosures expanded, including records arriving on refresh. */
export async function expandConversationInboxes(context: BrowserContext) {
	await context.addInitScript(() => {
		const expand = () => {
			for (const trigger of document.querySelectorAll<HTMLElement>(
				'[data-inbox] > [data-slot=collapsible-trigger][aria-expanded=false]'
			))
				trigger.click();
		};
		new MutationObserver(expand).observe(document, { childList: true, subtree: true });
	});
}
