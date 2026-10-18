import { expect, test } from 'bun:test';
import { applyEvent, createState, mergeHistory } from './reduce';
import { toMessages } from './project';
import { toolPresentation } from './tool-presentation';

const details = { input: '{"command":"maps search candy"}', output: 'maps: command not found' };
const steps = (state: ReturnType<typeof createState>) =>
	toMessages(state.items).flatMap((m) =>
		m.parts.flatMap((p) => (p.type === 'data-tool' ? [p.data] : []))
	);
test('input and failure output survive completion, snapshot, finalization and history', () => {
	const state = createState();
	applyEvent(state, {
		type: 'tool',
		data: { turnId: 't', id: 'one', name: 'bash', summary: 'maps…', input: details.input }
	});
	applyEvent(state, {
		type: 'tool',
		data: { turnId: 't', id: 'two', name: 'bash', summary: 'other' }
	});
	applyEvent(state, {
		type: 'tool',
		data: {
			turnId: 't',
			id: 'one',
			name: 'bash',
			summary: 'maps…',
			ok: false,
			output: details.output
		}
	});
	expect(steps(state)[0]).toMatchObject({ ...details, state: 'failed' });
	expect(steps(state)[1]?.output).toBeUndefined();
	const lines = [{ id: 'one', name: 'bash', summary: 'maps…', state: 'err' as const, ...details }];
	applyEvent(state, {
		type: 'snapshot',
		data: { turnId: 't', view: { turnId: 't', startedAt: 0, toolCount: 1, text: '', lines } }
	});
	expect(steps(state)[0]).toMatchObject(details);
	applyEvent(state, {
		type: 'turn_final',
		data: { turnId: 't', outcome: 'done', summary: null, lines }
	});
	expect(steps(state)[0]).toMatchObject(details);
	const cold = createState();
	mergeHistory(cold, [
		{
			type: 'assistant',
			id: 'm',
			at: 'x',
			text: 'Search failed.',
			files: [],
			tools: [{ id: 'one', name: 'bash', summary: 'maps…', ok: false, ...details }]
		}
	]);
	expect(steps(cold)[0]).toMatchObject(details);
});
test('action labels describe arguments without asserting effects or execution', () => {
	expect(toolPresentation('integrations', '{"action":"list"}').title).toBe('List integrations');
	expect(toolPresentation('integrations', 'action=list').title).toBe('List integrations');
	expect(toolPresentation('bash', details.input)).toMatchObject({
		title: 'Run command',
		detail: 'maps search candy'
	});
	expect(toolPresentation('unknown_tool', 'not json')).toMatchObject({ title: 'unknown tool' });
});

test('command details preserve working directory and other execution arguments', () => {
	const input = JSON.stringify({ command: 'rm report.txt', cwd: '/shared/reports' });
	expect(toolPresentation('bash', input).input).toBe(input);
});
