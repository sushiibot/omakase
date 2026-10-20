/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { LiveBlock } from '../../../../core/realtime/events';
import { parseMarkdown, type MdBlockNode } from '../markdown';
import {
	applyLiveOps,
	describeLiveBlock,
	fingerprint,
	liveBlocks,
	newLiveBlock,
	parseLiveBlockId
} from './live';

const fence = (type: string, body: string) => '```' + type + '\n' + body + '\n```';
const KEY = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const NOW = new Date('2026-10-20T12:00:00.000Z');
const at = (s: number) => new Date(NOW.getTime() + s * 1000);

function record(type: string, body: string): LiveBlock {
	const [entry] = liveBlocks(fence(type, body));
	return newLiveBlock(entry, KEY, 'main', NOW);
}

/** Every rendered rich node, in document order, with its live index. */
function richNodes(nodes: readonly MdBlockNode[]): Extract<MdBlockNode, { kind: 'rich' }>[] {
	return nodes.flatMap((n): Extract<MdBlockNode, { kind: 'rich' }>[] => {
		if (n.kind === 'rich') return [n];
		if (n.kind === 'quote' || n.kind === 'callout' || n.kind === 'details' || n.kind === 'card')
			return richNodes(n.children);
		if (n.kind === 'list') return n.items.flatMap((i) => richNodes(i.children));
		if (n.kind === 'columns') return n.columns.flatMap(richNodes);
		if (n.kind === 'tabs')
			return [...richNodes(n.intro), ...n.tabs.flatMap((t) => richNodes(t.children))];
		return [];
	});
}

describe('numbering', () => {
	const reply = [
		'Intro',
		fence('bars', 'items: [{label: a, value: 1}]'),
		fence('checklist', 'items: [milk, eggs]'),
		'- in a list:\n\n  ' + fence('timer', 'label: Tea\nduration: 4m').replace(/\n/g, '\n  '),
		fence('timer', 'label: broken'),
		':::callout{tone="info"}\n' + fence('choice', 'question: Day?\noptions: [Mon, Tue]') + '\n:::',
		':::tabs\n## A\n' +
			fence('recipe', 'title: Rice\ningredients: [{item: rice}]\nsteps: [Cook.]') +
			'\n\n## B\nx\n:::',
		fence('actions', 'items: [Yes]')
	].join('\n\n');

	test('the workspace and the renderer number live blocks the same way', () => {
		const stored = liveBlocks(reply);
		expect(stored.map((b) => b.block.type)).toEqual([
			'checklist',
			'timer',
			'choice',
			'recipe',
			'actions'
		]);
		const drawn = richNodes(parseMarkdown(reply)).filter((n) => n.live !== undefined);
		expect(drawn.map((n) => [n.live, n.block.type, fingerprint(n.block.data)])).toEqual(
			stored.map((b) => [b.index, b.block.type, b.fingerprint])
		);
	});

	test('display blocks, invalid blocks and open fences hold no live block', () => {
		expect(liveBlocks(fence('bars', 'items: [{label: a, value: 1}]'))).toEqual([]);
		expect(liveBlocks(fence('timer', 'label: x'))).toEqual([]);
		expect(liveBlocks('```checklist\nitems: [a]')).toEqual([]);
		expect(liveBlocks('x'.repeat(20_000) + '\n\n' + fence('checklist', 'items: [a]'))).toEqual([]);
	});

	test('ids name the reply and the place', () => {
		const block = record('checklist', 'items: [a]');
		expect(block.id).toBe(`${KEY}.0`);
		expect(parseLiveBlockId(block.id)).toEqual({ messageKey: KEY, index: 0 });
		expect(parseLiveBlockId('../x.0')).toBeNull();
	});
});

describe('changes', () => {
	test('checklist items keep their ids through edits and removals', () => {
		let block = record('checklist', 'title: Shop\nitems: [milk, { text: eggs, done: true }, rice]');
		expect(block.state.items!.map((i) => [i.id, i.text, i.done])).toEqual([
			[0, 'milk', false],
			[1, 'eggs', true],
			[2, 'rice', false]
		]);
		const r = applyLiveOps(
			block,
			[
				{ op: 'check', item: 0, done: true },
				{ op: 'remove', item: 1 },
				{ op: 'add', text: ' oat milk ' },
				{ op: 'edit', item: 2, text: 'brown rice' }
			],
			'owner',
			at(5)
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		block = r.block;
		expect(block.state.items!.map((i) => [i.id, i.text, i.done])).toEqual([
			[0, 'milk', true],
			[2, 'brown rice', false],
			[3, 'oat milk', false]
		]);
		expect(block.revision).toBe(2);
		expect(block.updatedBy).toBe('owner');
		expect(block.changes.at(-1)!.summary).toBe(
			'ticked “milk”; removed “eggs”; added “oat milk”; renamed “rice” to “brown rice”'
		);
		expect(describeLiveBlock(block, NOW)).toBe(
			'1/3 done. Open: 2:“brown rice”, 3:“oat milk”. Done: 0:“milk”'
		);
	});

	test('a batch is all or nothing, and never mutates its input', () => {
		const block = record('checklist', 'items: [milk]');
		const copy = structuredClone(block);
		const r = applyLiveOps(
			block,
			[
				{ op: 'check', item: 0, done: true },
				{ op: 'remove', item: 9 }
			],
			'agent',
			NOW
		);
		expect(r).toEqual({ ok: false, error: 'no item 9 in this checklist' });
		expect(block).toEqual(copy);
		expect(applyLiveOps(block, [{ op: 'start' }], 'agent', NOW)).toEqual({
			ok: false,
			error: `"start" doesn't apply to a checklist block`
		});
	});

	test('a timer runs on the server clock: start, pause, finish, reset, duration', () => {
		let block = record('timer', 'label: Tea\nduration: 4m');
		expect(describeLiveBlock(block, NOW)).toBe('not started (4:00)');
		const step = (op: Parameters<typeof applyLiveOps>[1][number], s: number) => {
			const r = applyLiveOps(block, [op], 'owner', at(s));
			if (!r.ok) throw new Error(r.error);
			block = r.block;
		};
		step({ op: 'start' }, 0);
		expect(block.state.endsAt).toBe(at(240).toISOString());
		expect(describeLiveBlock(block, at(60))).toBe(
			`running, 3:00 left (ends ${at(240).toISOString()})`
		);
		const rev = block.revision;
		step({ op: 'start' }, 10);
		expect(block.revision).toBe(rev);
		step({ op: 'pause' }, 100);
		expect(block.state).toMatchObject({ endsAt: null, left: 140 });
		expect(describeLiveBlock(block, at(500))).toBe('paused, 2:20 left');
		step({ op: 'start' }, 200);
		expect(describeLiveBlock(block, at(400))).toBe(`finished at ${at(340).toISOString()}`);
		step({ op: 'start' }, 400);
		expect(block.state.endsAt).toBe(at(640).toISOString());
		step({ op: 'reset' }, 401);
		step({ op: 'duration', seconds: 90 }, 402);
		expect((block.data as { duration: number }).duration).toBe(90);
		expect(block.state).toMatchObject({ endsAt: null, left: 90 });
	});

	test('a recipe keeps servings and ticked ingredients', () => {
		const block = record(
			'recipe',
			'title: Rice\nserves: 2\ningredients: [{item: rice}, {item: salt}]\nsteps: [Cook.]'
		);
		const r = applyLiveOps(
			block,
			[
				{ op: 'serves', n: 4 },
				{ op: 'got', item: 1, done: true }
			],
			'owner',
			NOW
		);
		expect(r.ok && r.block.state).toEqual({ serves: 4, got: [1] });
		expect(r.ok && describeLiveBlock(r.block, NOW)).toBe('serves 4; 1/2 ingredients ticked');
		expect(applyLiveOps(block, [{ op: 'got', item: 2, done: true }], 'owner', NOW).ok).toBe(false);
	});

	test('a reply block is answered once', () => {
		const block = record('choice', 'question: Day?\noptions: [Mon, Tue]');
		const r = applyLiveOps(block, [{ op: 'sent', text: 'Tue' }], 'owner', NOW);
		expect(r.ok && describeLiveBlock(r.block, NOW)).toBe('answered “Tue”');
		expect(r.ok && applyLiveOps(r.block, [{ op: 'sent', text: 'Mon' }], 'owner', NOW)).toEqual({
			ok: false,
			error: 'this block was already answered'
		});
	});

	test('the change log keeps the latest 20', () => {
		let block = record('checklist', 'items: [a]');
		for (let n = 0; n < 25; n++) {
			const r = applyLiveOps(block, [{ op: 'check', item: 0, done: n % 2 === 0 }], 'agent', at(n));
			if (r.ok) block = r.block;
		}
		expect(block.changes).toHaveLength(20);
		expect(block.revision).toBe(26);
	});
});
