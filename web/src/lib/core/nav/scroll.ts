import { afterNavigate, beforeNavigate, replaceState } from '$app/navigation';
import { page } from '$app/state';
import { onMount } from 'svelte';

type Position = { key: string; top: number; left: number };
const STORAGE = 'page-scroll:v1';
const RESUME = 'page-scroll:resume:v1';
const selector = 'main, main [data-tab-panel]';
const positions = new Map<string, Position[]>();

function scrollers(): Map<string, HTMLElement> {
	return new Map(
		[...document.querySelectorAll<HTMLElement>(selector)].map((el) => [
			el.tagName === 'MAIN' ? 'main' : `tab:${el.dataset.tabPanel}`,
			el
		])
	);
}

function persist() {
	while (positions.size > 100) positions.delete(positions.keys().next().value!);
	try {
		sessionStorage.setItem(STORAGE, JSON.stringify([...positions]));
	} catch {
		/* Storage can be unavailable. */
	}
}

/** Restore after asynchronous content arrives, without taking control away from the reader. */
function restore(wanted: Position[]): () => void {
	let frame = 0;
	let stopped = false;
	const stop = () => {
		stopped = true;
		cancelAnimationFrame(frame);
		clearTimeout(timer);
		mutations.disconnect();
		resize.disconnect();
		for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
			window.removeEventListener(event, stop, true);
		document.removeEventListener('load', schedule, true);
	};
	const attempt = () => {
		frame = 0;
		const elements = scrollers();
		let complete = true;
		for (const position of wanted) {
			const el = elements.get(position.key);
			if (!el) {
				complete = false;
				continue;
			}
			el.scrollTo({ top: position.top, left: position.left, behavior: 'instant' });
			if (Math.abs(el.scrollTop - position.top) > 1 || Math.abs(el.scrollLeft - position.left) > 1)
				complete = false;
		}
		if (complete) stop();
	};
	function schedule() {
		if (!stopped && !frame) frame = requestAnimationFrame(attempt);
	}
	const mutations = new MutationObserver(schedule);
	mutations.observe(document.body, { childList: true, subtree: true, characterData: true });
	const resize = new ResizeObserver(schedule);
	resize.observe(document.body);
	const timer = setTimeout(stop, 10_000);
	for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
		window.addEventListener(event, stop, { capture: true, passive: true });
	document.addEventListener('load', schedule, true);
	schedule();
	return stop;
}

/** Called once by the root layout. Kit restores window scroll; our pages scroll inside main/panels. */
export function restorePageScroll() {
	let active: string | undefined;
	let cancelRestore = () => {};
	let loaded = false;
	const save = () => {
		if (!active) return;
		positions.set(
			active,
			[...scrollers()].map(([key, el]) => ({ key, top: el.scrollTop, left: el.scrollLeft }))
		);
		persist();
	};
	beforeNavigate(() => {
		save();
		cancelRestore();
	});
	afterNavigate(({ type, from, to }) => {
		if (!loaded) {
			loaded = true;
			try {
				const entries: unknown = JSON.parse(sessionStorage.getItem(STORAGE) ?? '[]');
				if (Array.isArray(entries))
					for (const entry of entries.slice(-100)) {
						if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1]))
							continue;
						const valid = entry[1].filter(
							(p) =>
								p && typeof p.key === 'string' && Number.isFinite(p.top) && Number.isFinite(p.left)
						);
						positions.set(entry[0], valid);
					}
			} catch {
				/* Start fresh when storage is unavailable or invalid. */
			}
		}
		cancelRestore();
		const returning = type === 'popstate' || type === 'enter';
		let resume: string | undefined;
		if (type === 'enter') {
			// The SPA router starts with empty page.state after a full reload.
			const navigation = performance.getEntriesByType('navigation')[0] as
				PerformanceNavigationTiming | undefined;
			if (navigation?.type === 'reload' || navigation?.type === 'back_forward') {
				try {
					const saved = JSON.parse(sessionStorage.getItem(RESUME) ?? 'null');
					if (saved?.url === location.href && typeof saved.key === 'string') resume = saved.key;
				} catch {
					/* Ignore an invalid resume record. */
				}
			}
		}
		active = (returning && page.state.scrollEntry) || resume || crypto.randomUUID();
		replaceState('', { ...page.state, scrollEntry: active });
		// Leave anchor navigation to Kit; it scrolls the target's ancestors itself.
		if (to?.url?.hash && type !== 'popstate') return;
		if (
			from?.url?.pathname === to?.url?.pathname &&
			from?.url?.search === to?.url?.search &&
			type !== 'popstate'
		)
			return;
		cancelRestore = restore(
			(returning && positions.get(active)) || [{ key: 'main', top: 0, left: 0 }]
		);
	});
	onMount(() => {
		const hide = () => {
			save();
			try {
				sessionStorage.setItem(RESUME, JSON.stringify({ url: location.href, key: active }));
			} catch {
				/* Optional storage. */
			}
		};
		window.addEventListener('pagehide', hide);
		return () => {
			save();
			cancelRestore();
			window.removeEventListener('pagehide', hide);
		};
	});
}
