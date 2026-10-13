import { expect, test } from 'bun:test';
import { applyEvent, createState, mergeHistory } from './reduce';
import { toMessages } from './project';
const diff = { patch: '--- USER.md\n+++ USER.md\n@@ -1 +1 @@\n-old\n+new\n' };
const patches = (state: ReturnType<typeof createState>) =>
	toMessages(state.items).flatMap((message) =>
		message.parts.flatMap((part) => (part.type === 'data-tool' ? [part.data.diff] : []))
	);
test('edit diffs survive live completion, snapshots, finalization and cold history', () => {
	const state = createState();
	applyEvent(state, {
		type: 'tool',
		data: { turnId: 't', id: 'edit', name: 'edit', summary: 'USER.md' }
	});
	applyEvent(state, {
		type: 'tool',
		data: { turnId: 't', id: 'edit', name: 'edit', summary: 'USER.md', ok: true, diff }
	});
	expect(patches(state)).toEqual([diff]);
	const lines = [{ id: 'edit', name: 'edit', summary: 'USER.md', state: 'ok' as const, diff }];
	applyEvent(state, {
		type: 'snapshot',
		data: { turnId: 't', view: { turnId: 't', startedAt: 0, toolCount: 1, text: '', lines } }
	});
	expect(patches(state)).toEqual([diff]);
	applyEvent(state, {
		type: 'turn_final',
		data: { turnId: 't', outcome: 'done', summary: null, lines }
	});
	expect(patches(state)).toEqual([diff]);
	const restored = createState();
	mergeHistory(restored, [
		{
			type: 'assistant',
			id: '1',
			at: 'x',
			text: 'Updated.',
			files: [],
			tools: [{ id: 'edit', name: 'edit', summary: 'USER.md', ok: true, diff }]
		}
	]);
	expect(patches(restored)).toEqual([diff]);
});
