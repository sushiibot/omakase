import { goto } from '$app/navigation';
import { page } from '$app/state';
import { tick } from 'svelte';
import { leaveSheet, type RoutedSheet } from './sheet';

export const agentHref = (id: string) => `/agents/${encodeURIComponent(id)}`;

/** Leaves an open panel's history entry first, so Back from the agent returns to the conversation. */
export async function openAgentPage(href: string, sheet?: RoutedSheet) {
	await leaveSheet(sheet);
	await goto(href);
}

/**
 * A notification's `?agent=` link: the docked panel opens on that agent; a phone pushes the agent's
 * page over the conversation. The parameter comes off the address first, so Back never reopens it.
 */
export async function followAgentLink(opts: {
	/** Read after the first layout, once the shell knows its width. */
	docked: () => boolean;
	sheet: RoutedSheet;
	openPanel: (id: string) => void;
}) {
	const id = page.url.searchParams.get('agent');
	if (!id) return;
	await tick();
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	const url = new URL(page.url);
	url.searchParams.delete('agent');
	// A real replacing navigation: a shallow entry would bring the parameter back with Back.
	await goto(url.pathname + url.search + url.hash, {
		replaceState: true,
		noScroll: true,
		keepFocus: true
	});
	if (opts.docked()) {
		opts.openPanel(id);
		opts.sheet.openWith();
	} else await goto(agentHref(id));
}

/** A tap on an agent card: the docked panel shows it, a phone opens its page. Modified clicks keep the link's own behaviour. */
export function openAgentFrom(
	event: MouseEvent,
	id: string,
	opts: { docked: boolean; sheet: RoutedSheet; showInPanel: (id: string) => void }
) {
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
	event.preventDefault();
	if (opts.docked) {
		opts.showInPanel(id);
		if (!opts.sheet.open) opts.sheet.openWith();
	} else void openAgentPage(agentHref(id), opts.sheet);
}
