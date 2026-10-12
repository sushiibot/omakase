import type { ChannelActivity } from '../activity';
export function voiceStatus(input: {
	state: string;
	mode: string;
	muted: boolean;
	busy: boolean;
	working: boolean;
	phase: string;
	activity?: ChannelActivity | null;
	request?: string;
}): { label: string; detail: string; review?: boolean } {
	if (input.state === 'connecting') return { label: 'Connecting', detail: 'Starting voice chat' };
	if (input.state === 'speaking')
		return { label: 'Speaking', detail: 'Tap stop to interrupt the reply' };
	if (input.activity?.request && (input.working || input.phase === 'working'))
		return {
			label:
				input.activity.request.kind === 'approval' || input.activity.label.includes('approval')
					? 'Approval needed'
					: 'Your answer is needed',
			detail: 'Tap to review in chat',
			review: true
		};
	if (input.mode === 'turns' && input.busy && input.phase === 'transcribing')
		return { label: 'Transcribing', detail: 'Turning your speech into text' };
	if (input.working || (input.mode === 'turns' && input.busy && input.phase === 'working'))
		return {
			label:
				input.activity?.kind === 'thinking'
					? 'Thinking'
					: input.activity?.kind === 'typing'
						? 'Writing reply'
						: input.activity?.kind === 'tool'
							? input.activity.label.replace(/^Sushii is /, '').replace(/…$/, '')
							: 'Working',
			detail: input.activity?.detail || input.request || 'Tools and results appear in chat'
		};
	if (input.mode === 'turns' && input.busy)
		return { label: 'Preparing voice', detail: 'Generating the spoken reply' };
	if (input.muted) return { label: 'Microphone muted', detail: 'Tap the microphone to unmute' };
	if (input.phase === 'resuming')
		return { label: 'Opening microphone', detail: 'Getting ready for your next turn' };
	return {
		label: 'Listening',
		detail:
			input.mode === 'turns'
				? 'Pause to send · tap for call details'
				: 'Speak naturally · interrupt anytime'
	};
}
