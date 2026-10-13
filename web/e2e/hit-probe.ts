import { expect, type Locator, type Page } from '@playwright/test';

export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface HitProbeOptions {
	/** Sides without an adjacent control; each gets a probe 23px from the center. Defaults to all four. */
	freeSides?: Side[];
	/** Sides facing a neighbor that still need a full reach, as in decision rows with a touch gap. */
	neighborSides?: Side[];
}

export type HitPointKind = 'center' | 'edge' | 'reach';

export interface HitPointFailure {
	kind: HitPointKind;
	side?: Side;
	x: number;
	y: number;
	/** Short description of the element that received the point, or null when it fell outside the viewport. */
	hit: string | null;
}

export interface HitProbeResult {
	probed: number;
	failures: HitPointFailure[];
}

const ALL_SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
// 23px from the center keeps every point inside a 48px box after subpixel rounding.
const REACH = 23;
// Points exactly on the border box can resolve to the parent after subpixel rounding.
const EDGE_INSET = 1;

export async function probeHitArea(
	page: Page,
	control: Locator,
	opts: HitProbeOptions = {}
): Promise<HitProbeResult> {
	await control.scrollIntoViewIfNeeded();
	const reachSides = [
		...new Set([...(opts.freeSides ?? ALL_SIDES), ...(opts.neighborSides ?? [])])
	];
	const handle = await control.elementHandle();
	if (!handle) throw new Error('probeHitArea: control is not attached');
	try {
		return await page.evaluate(
			({ el, reachSides, allSides, reach, inset }): HitProbeResult => {
				const r = el.getBoundingClientRect();
				const cx = r.left + r.width / 2;
				const cy = r.top + r.height / 2;
				const offset: Record<Side, [number, number]> = {
					top: [0, -1],
					right: [1, 0],
					bottom: [0, 1],
					left: [-1, 0]
				};
				const edge: Record<Side, [number, number]> = {
					top: [cx, r.top + inset],
					right: [r.right - inset, cy],
					bottom: [cx, r.bottom - inset],
					left: [r.left + inset, cy]
				};
				const points: Omit<HitPointFailure, 'hit'>[] = [{ kind: 'center', x: cx, y: cy }];
				for (const side of allSides) {
					const [x, y] = edge[side];
					points.push({ kind: 'edge', side, x, y });
				}
				for (const side of reachSides) {
					const [dx, dy] = offset[side];
					points.push({ kind: 'reach', side, x: cx + dx * reach, y: cy + dy * reach });
				}
				const describe = (hit: Element) => {
					const slot = hit.getAttribute('data-slot');
					const name = hit.getAttribute('aria-label') ?? hit.textContent?.trim().slice(0, 40);
					return `<${hit.tagName.toLowerCase()}${slot ? ` data-slot="${slot}"` : ''}>${name ?? ''}`;
				};
				const failures = points.flatMap((p) => {
					const hit = document.elementFromPoint(p.x, p.y);
					if (hit && (hit === el || el.contains(hit))) return [];
					return [{ ...p, hit: hit ? describe(hit) : null }];
				});
				return { probed: points.length, failures };
			},
			{ el: handle, reachSides, allSides: ALL_SIDES, reach: REACH, inset: EDGE_INSET }
		);
	} finally {
		await handle.dispose();
	}
}

export async function expectHitArea(page: Page, control: Locator, opts?: HitProbeOptions) {
	const result = await probeHitArea(page, control, opts);
	expect(result.failures, `hit probe failures for ${control}`).toEqual([]);
	return result;
}
