import type { SavedItem, SavedKind, SavedStatus } from './types';

// Pure view logic for saved items: filters, grouping by source conversation, and what is "in use".
// No folders: an item is found again by where it came from, whether it is still in use, and pin.

export const KIND_LABEL: Record<SavedKind, string> = {
	document: 'Document',
	checklist: 'List',
	recipe: 'Recipe',
	timer: 'Timer'
};

/** The library's filter chips, in order. */
export const SAVED_CHIPS = [
	{ value: 'all', label: 'All' },
	{ value: 'docs', label: 'Docs' },
	{ value: 'lists', label: 'Lists' },
	{ value: 'recipes', label: 'Recipes' },
	{ value: 'timers', label: 'Timers' }
] as const;
export type SavedChip = (typeof SAVED_CHIPS)[number]['value'];

const CHIP_KIND: Record<SavedChip, SavedKind | undefined> = {
	all: undefined,
	docs: 'document',
	lists: 'checklist',
	recipes: 'recipe',
	timers: 'timer'
};
export const chipKind = (chip: SavedChip) => CHIP_KIND[chip];
export const isChip = (value: string | null): value is SavedChip =>
	SAVED_CHIPS.some((c) => c.value === value);

export function isSavedKind(value: string | undefined): value is SavedKind {
	return value === 'document' || value === 'checklist' || value === 'recipe' || value === 'timer';
}

/** A block id (`<reply key>.<n>`) in a page path uses `~` for the dot: the gateway answers a path
 *  that looks like a file name (`.0`) with 404 instead of the app. */
export const savedHref = (item: Pick<SavedItem, 'kind' | 'id'>) =>
	`/saved/${item.kind}/${encodeURIComponent(item.id.replace('.', '~'))}`;
/** The item id a page path names; the dotted form still reads. */
export const savedIdFromPath = (segment: string) => segment.replace('~', '.');

/** Items of one kind and status. */
export function filterSaved(
	items: readonly SavedItem[],
	opts: { chip?: SavedChip; status?: SavedStatus }
): SavedItem[] {
	const kind = opts.chip ? chipKind(opts.chip) : undefined;
	return items.filter(
		(i) => (!kind || i.kind === kind) && (!opts.status || i.status === opts.status)
	);
}

export interface SavedGroup {
	/** A conversation id, or `pinned`. */
	id: string;
	label: string;
	items: SavedItem[];
}

/** Pinned first, then one group per source conversation, the most recently used first. The
 *  items keep their order (the server's: pinned, then most recently used). */
export function groupSaved(
	items: readonly SavedItem[],
	titleOf: (conversationId: string) => string
): SavedGroup[] {
	const pinned = items.filter((i) => i.pinned);
	const groups = new Map<string, SavedItem[]>();
	for (const item of items) {
		if (item.pinned) continue;
		const list = groups.get(item.conversationId) ?? [];
		list.push(item);
		groups.set(item.conversationId, list);
	}
	return [
		...(pinned.length ? [{ id: 'pinned', label: 'Pinned', items: pinned }] : []),
		...[...groups].map(([id, list]) => ({ id, label: titleOf(id), items: list }))
	];
}

/** One conversation's items: active first, then done. */
export function conversationSaved(items: readonly SavedItem[], conversationId: string) {
	const mine = items.filter((i) => i.conversationId === conversationId);
	return {
		active: mine.filter((i) => i.status === 'active'),
		done: mine.filter((i) => i.status === 'done')
	};
}

const running = (item: SavedItem, now: number) =>
	item.kind === 'timer' && !!item.endsAt && Date.parse(item.endsAt) > now;
const openList = (item: SavedItem) =>
	item.kind === 'checklist' &&
	item.status === 'active' &&
	!!item.progress &&
	item.progress.done < item.progress.total;

/** Home's "In use": pinned items, running timers and open checklists, at most `max`. */
export function inUse(items: readonly SavedItem[], now: number, max = 4): SavedItem[] {
	const rank = (i: SavedItem) => (i.pinned ? 0 : running(i, now) ? 1 : 2);
	return items
		.filter((i) => i.pinned || running(i, now) || openList(i))
		.map((item, order) => ({ item, order }))
		.sort((a, b) => rank(a.item) - rank(b.item) || a.order - b.order)
		.slice(0, max)
		.map(({ item }) => item);
}

/** A row's state line: the summary, with a running timer's end as a local time. */
export function stateLine(item: SavedItem, now: number): string {
	if (item.kind === 'timer' && item.endsAt) {
		const end = Date.parse(item.endsAt);
		if (end > now) {
			const at = new Date(end).toLocaleTimeString(undefined, {
				hour: 'numeric',
				minute: '2-digit'
			});
			return `Running · ends ${at}`;
		}
		return 'Finished';
	}
	return item.summary;
}

/** A conversation's name for provenance, from the channel list when known. */
export function conversationTitle(
	conversationId: string,
	channels: readonly { id: string; title: string }[]
): string {
	const known = channels.find((c) => c.id === conversationId)?.title;
	if (known) return known;
	if (conversationId === 'main') return 'Main chat';
	if (conversationId.startsWith('task-t-')) return 'A task conversation';
	return 'An earlier conversation';
}
