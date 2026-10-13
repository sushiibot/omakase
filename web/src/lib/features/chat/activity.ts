import type { ChatMessage, PendingApproval, Turn, TurnStep } from './types';
import { toolCategory } from './tool-activity';

export interface ChannelActivity {
	kind: 'thinking' | 'typing' | 'tool' | 'working' | 'waiting' | 'stopping';
	label: string;
	detail?: string;
	request?: { kind: 'ask' | 'approval'; id: string };
}

/** Derive presence from current execution and unresolved decisions, never timers or fake progress. */
export function channelActivity(
	messages: ChatMessage[],
	running: boolean,
	stopping: boolean,
	approvals: PendingApproval[] = []
): ChannelActivity | null {
	if (stopping) return { kind: 'stopping', label: 'Stopping…' };
	for (const message of messages) {
		for (const part of message.parts) {
			const ask =
				part.type === 'data-ask'
					? part.data
					: part.type === 'data-tool'
						? part.data.confirmation
						: undefined;
			if (ask?.state === 'pending' || ask?.state === 'answering')
				return {
					kind: 'waiting',
					label: ask.toolConfirmation ? 'Waiting for your approval' : 'Waiting for your response',
					request: { kind: 'ask', id: ask.askId }
				};
		}
	}
	if (approvals[0])
		return {
			kind: 'waiting',
			label: 'Waiting for your approval',
			request: { kind: 'approval', id: approvals[0].nonce }
		};
	if (!running) return null;
	let turn: Turn | undefined;
	let step: TurnStep | undefined;
	let typing = false;
	let hasResponseText = false;
	for (const message of messages) {
		if (message.role !== 'assistant') continue;
		const active = message.parts.some(
			(part) =>
				part.type === 'data-turn' && ['working', 'thinking', 'stopping'].includes(part.data.state)
		);
		if (!active && !message.streaming) continue;
		for (const part of message.parts) {
			if (
				part.type === 'data-turn' &&
				['working', 'thinking', 'stopping'].includes(part.data.state)
			)
				turn = part.data;
			if (part.type === 'data-tool' && part.data.state === 'running') step = part.data;
		}
		hasResponseText ||= message.parts.some((part) => part.type === 'text' && part.text.length > 0);
		if (message.streaming && message.parts.some((part) => part.type === 'text' && part.text.length))
			typing = true;
	}
	step ??= turn?.steps.find((s) => s.state === 'running');
	if (step) {
		const labels = {
			read: 'Sushii is reading…',
			search: 'Sushii is searching…',
			bash: 'Sushii is running a command…',
			edit: 'Sushii is editing…',
			browse: 'Sushii is browsing…',
			database: 'Sushii is querying data…',
			agent: 'Sushii is delegating work…',
			other: 'Sushii is using a tool…'
		};
		return { kind: 'tool', label: labels[toolCategory(step.tool).kind], detail: step.label };
	}
	if (turn?.toolRunning) return { kind: 'tool', label: 'Sushii is using a tool…' };
	if (turn?.state === 'stopping') return { kind: 'stopping', label: 'Stopping…' };
	if (
		!hasResponseText &&
		(!turn?.label || ['Working…', 'Thinking…', 'Waiting for the model…'].includes(turn.label))
	)
		return { kind: 'typing', label: 'Sushii is typing…' };
	if (turn?.modelActivity === 'waiting')
		return {
			kind: 'working',
			label: turn.label && turn.label !== 'Working…' ? turn.label : 'Waiting for the model…'
		};
	if (turn?.modelActivity === 'thinking') return { kind: 'thinking', label: 'Sushii is thinking…' };
	if (typing && (turn?.modelActivity === undefined || turn.modelActivity === 'responding'))
		return null;
	if (turn?.state === 'thinking' || turn?.label === 'Thinking…')
		return { kind: 'thinking', label: 'Sushii is thinking…' };
	if (turn?.label && !['Working…', 'Thinking…'].includes(turn.label))
		return { kind: 'working', label: turn.label };
	return { kind: 'working', label: 'Sushii is working…' };
}
