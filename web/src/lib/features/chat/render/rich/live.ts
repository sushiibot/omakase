import type { Code, Nodes } from 'mdast';
import type {
	LiveBlock,
	LiveBlockOp,
	LiveBlockState,
	LiveBlockType
} from '../../../../core/realtime/events';
import {
	formatDuration,
	isRichType,
	parseRichBlock,
	type RichBlock,
	type RichData
} from './blocks';
import { fenceClosed, parseReplyTree } from './syntax';

// Live blocks: the stateful rich blocks in a reply, stored in the workspace so the owner (web) and
// the agent (tools) both read and change them. This file is shared: the workspace store registers
// blocks and applies changes with it, and the web renderer numbers blocks and applies changes
// optimistically with the same code, so both sides always agree on ids and results.

/** What a reply's renderer needs from the live-block store (live-blocks.svelte.ts). */
export interface LiveBlockAccess {
	/** Starts loading these replies' blocks; known keys are not fetched again. */
	watch(keys: readonly string[]): void;
	get(messageKey: string, index: number): LiveBlock | undefined;
	apply(id: string, ops: readonly LiveBlockOp[]): void;
}

/** One stored block, bound to the block a component draws. */
export interface LiveBinding {
	block: LiveBlock;
	apply(ops: readonly LiveBlockOp[]): void;
}

export const LIVE_TYPES: readonly LiveBlockType[] = [
	'checklist',
	'recipe',
	'timer',
	'actions',
	'choice',
	'form'
];

export function isLiveType(type: string | null | undefined): type is LiveBlockType {
	return !!type && (LIVE_TYPES as readonly string[]).includes(type);
}

/** Replies longer than this render unparsed (markdown.ts MARKDOWN_PARSE_MAX), so hold no blocks. */
const LIVE_PARSE_MAX = 16_000;
export const LIVE_CHECKLIST_MAX = 100;
const CHANGES_KEPT = 20;
const KEY_RE = /^[0-9A-Za-z_-]{8,64}$/;
const ID_RE = /^([0-9A-Za-z_-]{8,64})\.(\d{1,2})$/;

export const liveBlockId = (messageKey: string, index: number) => `${messageKey}.${index}`;
export const isMessageKey = (key: string) => KEY_RE.test(key);
export function parseLiveBlockId(id: string): { messageKey: string; index: number } | null {
	const m = ID_RE.exec(id);
	return m ? { messageKey: m[1], index: Number(m[2]) } : null;
}

/** FNV-1a of the block's data, as 8 hex digits. */
export function fingerprint(data: unknown): string {
	const text = JSON.stringify(data);
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

/** The live blocks of a finished reply, numbered in document order. The renderer numbers the
 *  valid, closed live fences it draws the same way (`Renderer.code` in markdown.ts). */
export function liveBlocks(
	text: string
): { index: number; block: RichBlock; fingerprint: string }[] {
	if (text.length > LIVE_PARSE_MAX) return [];
	let root;
	try {
		root = parseReplyTree(text);
	} catch {
		return [];
	}
	const out: { index: number; block: RichBlock; fingerprint: string }[] = [];
	const visit = (node: Nodes) => {
		if (node.type === 'code') {
			const code = node as Code;
			if (isLiveType(code.lang) && isRichType(code.lang) && fenceClosed(code, text)) {
				const result = parseRichBlock(code.lang, code.value);
				if (result.ok) {
					out.push({
						index: out.length,
						block: result.block,
						fingerprint: fingerprint(result.block.data)
					});
				}
			}
			return;
		}
		if ('children' in node) for (const child of node.children) visit(child as Nodes);
	};
	visit(root);
	return out.slice(0, 50);
}

export function blockTitle(block: RichBlock): string {
	switch (block.type) {
		case 'checklist':
			return block.data.title ?? 'Checklist';
		case 'recipe':
			return block.data.title;
		case 'timer':
			return block.data.label;
		case 'actions':
			return block.data.prompt ?? 'Reply options';
		case 'choice':
			return block.data.question;
		case 'form':
			return block.data.title ?? 'Form';
		default:
			return block.type;
	}
}

export function initialState(block: RichBlock): LiveBlockState {
	switch (block.type) {
		case 'checklist': {
			const items = block.data.items.map((item, id) => ({ id, text: item.text, done: item.done }));
			return { items, nextItem: items.length };
		}
		case 'recipe':
			return { ...(block.data.serves ? { serves: block.data.serves } : {}), got: [] };
		case 'timer':
			return { endsAt: null, left: block.data.duration };
		default:
			return { sent: null };
	}
}

/** A new record for a block of a just-delivered reply. */
export function newLiveBlock(
	entry: { index: number; block: RichBlock; fingerprint: string },
	messageKey: string,
	conversationId: string,
	now: Date
): LiveBlock {
	const at = now.toISOString();
	return {
		id: liveBlockId(messageKey, entry.index),
		messageKey,
		index: entry.index,
		conversationId,
		type: entry.block.type as LiveBlockType,
		title: blockTitle(entry.block).slice(0, 200),
		fingerprint: entry.fingerprint,
		data: entry.block.data,
		state: initialState(entry.block),
		revision: 1,
		createdAt: at,
		updatedAt: at,
		updatedBy: 'agent',
		changes: []
	};
}

const quote = (s: string) => `“${s.length > 60 ? s.slice(0, 59) + '…' : s}”`;

/** Applies `ops` in order. Either all apply and the record comes back with its revision bumped
 *  and the change logged, or none do and the first problem is returned. Pure: never mutates. */
export function applyLiveOps(
	record: LiveBlock,
	ops: readonly LiveBlockOp[],
	by: 'owner' | 'agent',
	now: Date
): { ok: true; block: LiveBlock } | { ok: false; error: string } {
	const state: LiveBlockState = structuredClone(record.state);
	let data = record.data;
	const summaries: string[] = [];
	const fail = (error: string) => ({ ok: false as const, error });
	for (const op of ops) {
		const wrong = () => fail(`"${op.op}" doesn't apply to a ${record.type} block`);
		switch (op.op) {
			case 'check':
			case 'edit':
			case 'remove': {
				if (record.type !== 'checklist') return wrong();
				const items = state.items ?? [];
				const at = items.findIndex((i) => i.id === op.item);
				if (at < 0) return fail(`no item ${op.item} in this checklist`);
				if (op.op === 'check') {
					items[at] = { ...items[at], done: op.done };
					summaries.push(`${op.done ? 'ticked' : 'unticked'} ${quote(items[at].text)}`);
				} else if (op.op === 'edit') {
					const text = op.text.trim();
					if (!text || text.length > 200) return fail('item text must be 1–200 characters');
					summaries.push(`renamed ${quote(items[at].text)} to ${quote(text)}`);
					items[at] = { ...items[at], text };
				} else {
					summaries.push(`removed ${quote(items[at].text)}`);
					items.splice(at, 1);
				}
				state.items = items;
				break;
			}
			case 'add': {
				if (record.type !== 'checklist') return wrong();
				const text = op.text.trim();
				if (!text || text.length > 200) return fail('item text must be 1–200 characters');
				const items = state.items ?? [];
				if (items.length >= LIVE_CHECKLIST_MAX)
					return fail(`a checklist holds at most ${LIVE_CHECKLIST_MAX} items`);
				const id = state.nextItem ?? items.length;
				state.items = [...items, { id, text, done: false }];
				state.nextItem = id + 1;
				summaries.push(`added ${quote(text)}`);
				break;
			}
			case 'serves': {
				if (record.type !== 'recipe') return wrong();
				if (!Number.isInteger(op.n) || op.n < 1 || op.n > 100)
					return fail('servings must be 1–100');
				state.serves = op.n;
				summaries.push(`set servings to ${op.n}`);
				break;
			}
			case 'got': {
				if (record.type !== 'recipe') return wrong();
				const ingredients = (data as RichData<'recipe'>).ingredients;
				if (!Number.isInteger(op.item) || op.item < 0 || op.item >= ingredients.length) {
					return fail(`no ingredient ${op.item} in this recipe`);
				}
				const got = new Set(state.got ?? []);
				if (op.done) got.add(op.item);
				else got.delete(op.item);
				state.got = [...got].sort((a, b) => a - b);
				summaries.push(`${op.done ? 'ticked' : 'unticked'} ${quote(ingredients[op.item].item)}`);
				break;
			}
			case 'start':
			case 'pause':
			case 'reset':
			case 'duration': {
				if (record.type !== 'timer') return wrong();
				const timer = data as RichData<'timer'>;
				const left = timerLeft(state, timer.duration, now);
				if (op.op === 'start') {
					if (state.endsAt && left > 0) break;
					const seconds = left > 0 ? left : timer.duration;
					state.endsAt = new Date(now.getTime() + seconds * 1000).toISOString();
					state.left = seconds;
					summaries.push(`started the timer (${formatDuration(seconds)})`);
				} else if (op.op === 'pause') {
					if (!state.endsAt) break;
					state.endsAt = null;
					state.left = left;
					summaries.push(`paused the timer at ${formatDuration(left)}`);
				} else if (op.op === 'reset') {
					state.endsAt = null;
					state.left = timer.duration;
					summaries.push('reset the timer');
				} else {
					if (!Number.isInteger(op.seconds) || op.seconds < 1 || op.seconds > 86_400) {
						return fail('duration must be 1 second to 24 hours');
					}
					data = { ...timer, duration: op.seconds };
					state.endsAt = null;
					state.left = op.seconds;
					summaries.push(`set the timer to ${formatDuration(op.seconds)}`);
				}
				break;
			}
			case 'sent': {
				if (record.type !== 'actions' && record.type !== 'choice' && record.type !== 'form')
					return wrong();
				if (state.sent) return fail('this block was already answered');
				const text = op.text.trim();
				if (!text || text.length > 2000) return fail('the answer must be 1–2000 characters');
				state.sent = text;
				summaries.push(`answered ${quote(text)}`);
				break;
			}
			default:
				return fail('unknown change');
		}
	}
	if (!summaries.length) return { ok: true, block: record };
	const at = now.toISOString();
	return {
		ok: true,
		block: {
			...record,
			data,
			state,
			revision: record.revision + 1,
			updatedAt: at,
			updatedBy: by,
			changes: [...record.changes, { at, by, summary: summaries.join('; ').slice(0, 200) }].slice(
				-CHANGES_KEPT
			)
		}
	};
}

/** Seconds left on a timer at `now`: counting down while running, else as paused. */
export function timerLeft(state: LiveBlockState, duration: number, now: Date): number {
	if (state.endsAt)
		return Math.max(0, Math.ceil((Date.parse(state.endsAt) - now.getTime()) / 1000));
	return state.left ?? duration;
}

/** One line of current state, for the agent's context and tool results. */
export function describeLiveBlock(block: LiveBlock, now: Date): string {
	const s = block.state;
	switch (block.type) {
		case 'checklist': {
			const items = s.items ?? [];
			const done = items.filter((i) => i.done);
			const open = items.filter((i) => !i.done);
			const list = (xs: typeof items) =>
				xs.map((i) => `${i.id}:${quote(i.text)}`).join(', ') || 'none';
			return `${done.length}/${items.length} done. Open: ${list(open)}. Done: ${list(done)}`;
		}
		case 'recipe': {
			const recipe = block.data as RichData<'recipe'>;
			const got = s.got ?? [];
			return `serves ${s.serves ?? recipe.serves ?? '?'}; ${got.length}/${recipe.ingredients.length} ingredients ticked`;
		}
		case 'timer': {
			const timer = block.data as RichData<'timer'>;
			const left = timerLeft(s, timer.duration, now);
			if (s.endsAt && left === 0) return `finished at ${s.endsAt}`;
			if (s.endsAt) return `running, ${formatDuration(left)} left (ends ${s.endsAt})`;
			return left === timer.duration
				? `not started (${formatDuration(left)})`
				: `paused, ${formatDuration(left)} left`;
		}
		default:
			return s.sent ? `answered ${quote(s.sent)}` : 'not answered yet';
	}
}
