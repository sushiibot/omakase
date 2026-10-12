import { describe, expect, test } from 'bun:test';
import { channelActivity } from './activity';
import type { ChatMessage, Turn } from './types';
const message = (turn: Turn, streaming = false): ChatMessage => ({
	id: 'reply',
	role: 'assistant',
	streaming,
	parts: [
		{ type: 'text', text: streaming ? 'Hello' : '' },
		{ type: 'data-turn', data: turn }
	]
});

describe('channel activity', () => {
	test('typing requires actual live text; thinking and preparation retain their own states', () => {
		expect(channelActivity([message({ state: 'thinking', steps: [] })], true, false)?.kind).toBe(
			'thinking'
		);
		expect(
			channelActivity([message({ state: 'working', steps: [] }, true)], true, false)?.label
		).toBe('Sushii is typing…');
		expect(
			channelActivity(
				[message({ state: 'working', steps: [], label: 'Waiting for the model…' })],
				true,
				false
			)?.label
		).toBe('Waiting for the model…');
		expect(channelActivity([message({ state: 'working', steps: [] })], true, false)?.kind).toBe(
			'working'
		);
	});
	test('active tools override old streamed text; completed tools do not claim ongoing work', () => {
		const step = {
			id: 'read',
			tool: 'read',
			label: 'Read workspace',
			input: '',
			state: 'running' as const
		};
		const toolMessage = message({ state: 'working', steps: [step] }, true);
		expect(channelActivity([toolMessage], true, false)?.label).toBe('Sushii is reading…');
		toolMessage.parts.push({ type: 'data-tool', data: { ...step, tool: 'delegate' } });
		expect(channelActivity([toolMessage], true, false)?.label).toBe('Sushii is delegating work…');
		expect(
			channelActivity([message({ state: 'done', steps: [{ ...step, state: 'ok' }] })], false, false)
		).toBeNull();
	});
	test('pending questions remain actionable while idle and never claim typing', () => {
		const ask: ChatMessage = {
			id: 'ask',
			role: 'assistant',
			parts: [
				{
					type: 'data-ask',
					data: { askId: 'a1', question: 'When?', choices: ['Today', 'Tomorrow'], state: 'pending' }
				}
			]
		};
		expect(channelActivity([ask], false, false)).toEqual({
			kind: 'waiting',
			label: 'Waiting for your response',
			request: { kind: 'ask', id: 'a1' }
		});
		if (ask.parts[0].type === 'data-ask') ask.parts[0].data.state = 'history';
		expect(channelActivity([ask], false, false)).toBeNull();
	});
	test('approval handles are exact and stop state overrides waiting', () => {
		const approval = {
			nonce: 'canonical',
			view: { tool: 'bash', agentId: 'main', agentName: 'Sushii', fields: [] }
		};
		expect(channelActivity([], false, false, [approval])).toMatchObject({
			kind: 'waiting',
			request: { kind: 'approval', id: 'canonical' }
		});
		expect(channelActivity([], true, true, [approval])).toEqual({
			kind: 'stopping',
			label: 'Stopping…'
		});
	});
});

test('snapshot phases after old text or completed tools do not resurrect typing', async () => {
	const { createState, applyEvent } = await import('./reduce');
	const { toMessages } = await import('./project');
	const state = createState();
	const activity = () => channelActivity(toMessages(state.items), true, false);
	applyEvent(state, { type: 'delta', data: { turnId: 't', offset: 0, text: 'Old text' } });
	expect(activity()?.kind).toBe('typing');
	applyEvent(state, {
		type: 'tool',
		data: { turnId: 't', name: 'read', summary: 'Read file', id: 'call' }
	});
	expect(activity()?.kind).toBe('tool');
	applyEvent(state, {
		type: 'tool',
		data: { turnId: 't', name: 'read', summary: 'Read file', id: 'call', ok: true }
	});
	expect(activity()?.label).toBe('Waiting for the model…');
	applyEvent(state, {
		type: 'snapshot',
		data: {
			turnId: 't',
			view: {
				turnId: 't',
				startedAt: 0,
				lines: [{ name: 'read', summary: 'Read file', id: 'call', state: 'ok' }],
				toolCount: 1,
				text: 'Old text',
				modelActivity: 'thinking'
			}
		}
	});
	expect(activity()?.kind).toBe('thinking');
	applyEvent(state, {
		type: 'snapshot',
		data: {
			turnId: 't',
			view: {
				turnId: 't',
				startedAt: 0,
				lines: [],
				toolCount: 1,
				text: 'Old text',
				modelActivity: 'waiting'
			}
		}
	});
	expect(activity()?.label).toBe('Waiting for the model…');
	applyEvent(state, { type: 'delta', data: { turnId: 't', offset: 8, text: ' again' } });
	expect(activity()?.kind).toBe('typing');
});
