import type { LiveBlock } from '$lib/core/realtime/events';
import type { Artifact, SavedItem } from './types';

// Sample saved items for the prototype board, `bun dev ?fake` and the browser tests: a pinned
// grocery list in Main, a running timer, a trip document and checklist, a recipe, and a finished
// list. Ids are stable so tests can open them.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const iso = (now: number, minutesAgo: number) => new Date(now - minutesAgo * MIN).toISOString();

export const SAVED_IDS = {
	groceries: '01JSAVEDGROCERIES000000000.0',
	tea: '01JSAVEDTEATIMER0000000000.0',
	packing: '01JSAVEDPACKING00000000000.0',
	pancakes: '01JSAVEDPANCAKES0000000000.0',
	moving: '01JSAVEDMOVING000000000000.0',
	plan: '00000000-0000-4000-8000-00000000a001'
} as const;

export const SAVED_SOURCES = {
	groceries: '01JSAVEDGROCERIES000000000',
	plan: '01JSAVEDTRIPPLANREPLY00000'
} as const;

export function savedBlocks(now: number): LiveBlock[] {
	const base = (
		id: string,
		conversationId: string,
		minutesAgo: number
	): Omit<LiveBlock, 'type' | 'title' | 'data' | 'state' | 'fingerprint'> => ({
		id,
		messageKey: id.split('.')[0],
		index: 0,
		conversationId,
		revision: 2,
		createdAt: iso(now, minutesAgo + 60),
		updatedAt: iso(now, minutesAgo),
		updatedBy: 'owner',
		changes: []
	});
	return [
		{
			...base(SAVED_IDS.groceries, 'main', 20),
			type: 'checklist',
			title: 'Groceries',
			fingerprint: '00000001',
			data: { title: 'Groceries', items: [] },
			state: {
				items: [
					{ id: 0, text: 'Milk', done: true },
					{ id: 1, text: 'Eggs', done: false },
					{ id: 2, text: 'Coffee beans', done: false }
				],
				nextItem: 3
			}
		},
		{
			...base(SAVED_IDS.tea, 'main', 2),
			type: 'timer',
			title: 'Tea',
			fingerprint: '00000002',
			data: { label: 'Tea', duration: 240 },
			state: { endsAt: new Date(now + 3 * MIN).toISOString(), left: 240 }
		},
		{
			...base(SAVED_IDS.packing, 'oct-trip', 300),
			type: 'checklist',
			title: 'Packing list',
			fingerprint: '00000003',
			data: { title: 'Packing list', items: [] },
			state: {
				items: [
					{ id: 0, text: 'Passport', done: true },
					{ id: 1, text: 'Charger', done: false }
				],
				nextItem: 2
			}
		},
		{
			...base(SAVED_IDS.pancakes, 'main', 3 * 24 * 60),
			type: 'recipe',
			title: 'Pancakes',
			fingerprint: '00000004',
			data: {
				title: 'Pancakes',
				serves: 2,
				ingredients: [
					{ item: 'flour', qty: 100, unit: 'g' },
					{ item: 'milk', qty: 200, unit: 'ml' }
				],
				steps: ['Whisk everything.', 'Fry for 2 minutes a side.']
			},
			state: { serves: 2, got: [] }
		},
		{
			...base(SAVED_IDS.moving, 'lease', 10 * 24 * 60),
			type: 'checklist',
			title: 'Moving day',
			fingerprint: '00000005',
			data: { title: 'Moving day', items: [] },
			state: { items: [{ id: 0, text: 'Book the van', done: true }], nextItem: 1 }
		}
	];
}

export function savedDocuments(now: number): Artifact[] {
	return [
		{
			id: SAVED_IDS.plan,
			title: 'October trip plan',
			createdAt: iso(now, 2 * 24 * 60),
			updatedAt: iso(now, 26 * 60),
			conversationId: 'oct-trip',
			version: 2,
			content:
				'# October trip\n\nFly out Friday morning, back Sunday night.\n\n## Bookings\n\n- Hotel near the station\n- Seats 24C and 24D'
		}
	];
}

export function savedItems(now: number): SavedItem[] {
	const blocks = savedBlocks(now);
	const block = (id: string) => blocks.find((b) => b.id === id)!;
	const fromBlock = (
		b: LiveBlock,
		extra: Partial<SavedItem> & Pick<SavedItem, 'summary'>
	): SavedItem => ({
		kind: b.type as SavedItem['kind'],
		id: b.id,
		title: b.title,
		conversationId: b.conversationId,
		sourceMessageId: b.messageKey,
		status: 'active',
		pinned: false,
		archived: false,
		createdAt: b.createdAt,
		updatedAt: b.updatedAt,
		updatedBy: b.updatedBy,
		...extra
	});
	const plan = savedDocuments(now)[0];
	return [
		fromBlock(block(SAVED_IDS.groceries), {
			pinned: true,
			summary: '1 of 3 done',
			progress: { done: 1, total: 3 }
		}),
		fromBlock(block(SAVED_IDS.tea), {
			summary: 'Running · 3:00 left',
			endsAt: new Date(now + 3 * MIN).toISOString()
		}),
		fromBlock(block(SAVED_IDS.packing), {
			summary: '1 of 2 done',
			progress: { done: 1, total: 2 }
		}),
		{
			kind: 'document',
			id: plan.id,
			title: plan.title,
			conversationId: plan.conversationId,
			sourceMessageId: SAVED_SOURCES.plan,
			status: 'active',
			pinned: false,
			archived: false,
			createdAt: plan.createdAt,
			updatedAt: plan.updatedAt,
			updatedBy: 'agent',
			summary: 'Version 2 · October trip Fly out Friday morning, back Sunday night.'
		},
		fromBlock(block(SAVED_IDS.pancakes), { summary: 'Serves 2 · 2 ingredients' }),
		fromBlock(block(SAVED_IDS.moving), {
			status: 'done',
			summary: '1 of 1 done',
			progress: { done: 1, total: 1 },
			updatedAt: new Date(now - 10 * DAY).toISOString()
		})
	];
}
