import { expect, type Locator, type Page } from '@playwright/test';

export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface HitProbeOptions {
	/** Sides without an adjacent control; each gets a probe 23px from the center. Defaults to all four. */
	freeSides?: Side[];
}

export type HitPointKind = 'center' | 'edge' | 'reach';

export interface HitPointFailure {
	kind: HitPointKind;
	side?: Side;
	x: number;
	y: number;
	reason: 'off-viewport' | 'other-element';
	/** Short description of the element that received the point, or null when nothing did. */
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

// `page` stays in the signature for callers; the probe runs in the control's own frame.
export async function probeHitArea(
	page: Page,
	control: Locator,
	opts: HitProbeOptions = {}
): Promise<HitProbeResult> {
	return control.evaluate(
		(el, { reachSides, allSides, reach, inset }): HitProbeResult => {
			// Centering keeps reach points clear of the viewport edge and of sticky headers or composers.
			el.scrollIntoView({ block: 'center', inline: 'center' });
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
			const points: Omit<HitPointFailure, 'hit' | 'reason'>[] = [{ kind: 'center', x: cx, y: cy }];
			for (const side of allSides) {
				const [x, y] = edge[side];
				points.push({ kind: 'edge', side, x, y });
			}
			for (const side of reachSides) {
				const [dx, dy] = offset[side];
				points.push({ kind: 'reach', side, x: cx + dx * reach, y: cy + dy * reach });
			}
			const root = el.getRootNode() as Document | ShadowRoot;
			const describe = (hit: Element) => {
				const slot = hit.getAttribute('data-slot');
				const name = hit.getAttribute('aria-label') ?? hit.textContent?.trim().slice(0, 40);
				return `<${hit.tagName.toLowerCase()}${slot ? ` data-slot="${slot}"` : ''}>${name ?? ''}`;
			};
			const failures = points.flatMap((p): HitPointFailure[] => {
				if (p.x < 0 || p.y < 0 || p.x >= innerWidth || p.y >= innerHeight) {
					return [{ ...p, reason: 'off-viewport', hit: null }];
				}
				const hit = root.elementFromPoint(p.x, p.y);
				if (hit && (hit === el || el.contains(hit))) return [];
				return [{ ...p, reason: 'other-element', hit: hit ? describe(hit) : null }];
			});
			return { probed: points.length, failures };
		},
		{
			reachSides: opts.freeSides ?? ALL_SIDES,
			allSides: ALL_SIDES,
			reach: REACH,
			inset: EDGE_INSET
		}
	);
}

export async function expectHitArea(page: Page, control: Locator, opts?: HitProbeOptions) {
	const result = await probeHitArea(page, control, opts);
	expect(result.failures, `hit probe failures for ${control}`).toEqual([]);
	return result;
}

/** Whether a tap `distance` px outside the control's face, at the middle of `side`, reaches it. */
export async function outsideFace(control: Locator, side: Side, distance: number) {
	return control.evaluate(
		(el, { side, distance }) => {
			el.scrollIntoView({ block: 'center', inline: 'center' });
			const r = el.getBoundingClientRect();
			const cx = r.left + r.width / 2;
			const cy = r.top + r.height / 2;
			const point: Record<Side, [number, number]> = {
				top: [cx, r.top - distance],
				right: [r.right + distance, cy],
				bottom: [cx, r.bottom + distance],
				left: [r.left - distance, cy]
			};
			const hit = (el.getRootNode() as Document | ShadowRoot).elementFromPoint(...point[side]);
			return !!hit && (hit === el || el.contains(hit));
		},
		{ side, distance }
	);
}
