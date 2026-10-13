import { expect, test } from 'bun:test';
import { applyEvent, createState, mergeHistory } from './reduce';
import { toMessages } from './project';

const view = { tool: 'bash', agentId: 'main', agentName: 'Main', fields: [] };

for (const anchored of [false, true]) {
	test(`live approvals retain chronology when history overlaps (anchored: ${anchored})`, () => {
		const state = createState();
		if (anchored)
			applyEvent(state, {
				type: 'tool',
				data: { turnId: 'turn', id: 'call', name: 'bash', summary: 'pwd' }
			});
		applyEvent(state, { type: 'approval', data: { nonce: 'n', view } });
		applyEvent(state, { type: 'approval_resolved', data: { nonce: 'n', decision: 'approve' } });
		applyEvent(state, {
			type: 'reply',
			data: { key: 'reply', turnId: 'turn', text: 'Finished', files: [] }
		});
		mergeHistory(state, [
			{ type: 'approval', id: '1', at: 'x', nonce: 'n', view, decision: 'approve' },
			{
				type: 'assistant',
				id: '2',
				at: 'x',
				outboxId: 'reply',
				turnId: 'turn',
				text: 'Finished',
				tools: [],
				files: []
			},
			{ type: 'user', id: '3', at: 'x', clientId: 'later', text: 'Next message', attachments: [] }
		]);
		expect(state.items.map((item) => item.kind)).toEqual(['approval', 'assistant', 'user']);
		expect(state.items[0]).toMatchObject({ outcome: 'approved-elsewhere' });
		const messages = toMessages(state.items);
		expect(messages.at(-1)?.role).toBe('user');
		expect(
			messages
				.flatMap((message) => message.parts)
				.filter(
					(part) =>
						part.type === 'data-approval' || (part.type === 'data-tool' && part.data.approval)
				)
		).toHaveLength(1);
	});
}

test('a live tool confirmation moves before later history without losing its decision', () => {
	const state = createState();
	const toolConfirmation = {
		tool: 'bash',
		input: 'pwd',
		reason: 'Check directory',
		toolCallId: 'call'
	};
	applyEvent(state, {
		type: 'ask',
		data: { key: 'ask', askId: 'ask', question: 'Allow?', choices: ['Yes', 'No'], toolConfirmation }
	});
	applyEvent(state, { type: 'ask_resolved', data: { askId: 'ask', answer: 'Yes' } });
	mergeHistory(state, [
		{
			type: 'ask',
			id: '1',
			outboxId: 'ask',
			at: 'x',
			askId: 'ask',
			question: 'Allow?',
			choices: ['Yes', 'No'],
			toolConfirmation
		},
		{
			type: 'assistant',
			id: '2',
			at: 'x',
			outboxId: 'reply',
			text: 'Finished',
			tools: [],
			files: []
		},
		{ type: 'user', id: '3', at: 'x', clientId: 'later', text: 'Next message', attachments: [] }
	]);
	expect(state.items.map((item) => item.kind)).toEqual(['ask', 'assistant', 'user']);
	expect(state.items[0]).toMatchObject({ answer: 'Yes' });
	expect(toMessages(state.items).at(-1)?.role).toBe('user');
});
