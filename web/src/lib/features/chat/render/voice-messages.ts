import type { ChatMessage } from '../types';
export interface VoiceTranscript {
	id: string;
	anchors: string[];
	userText: string;
	userFinal: boolean;
	assistantText: string;
	assistantFinal: boolean;
	userId?: string;
	assistantId?: string;
}
const text = (m: ChatMessage) =>
	m.parts
		.filter((p) => p.type === 'text')
		.map((p) => (p.type === 'text' ? p.text : ''))
		.join('');
export function voiceMessages(
	messages: ChatMessage[],
	transcripts: VoiceTranscript[]
): ChatMessage[] {
	const result = [...messages];
	for (const transcript of transcripts) {
		const newer = (m: ChatMessage) => !transcript.anchors.includes(m.id);
		let user = result.find(
			(m) =>
				m.role === 'user' &&
				(transcript.userId
					? m.clientId === transcript.userId
					: newer(m) && text(m) === transcript.userText)
		);
		let reply = result.find(
			(m) =>
				m.role === 'assistant' &&
				(transcript.assistantId
					? m.turnId === transcript.assistantId
					: newer(m) && !!transcript.assistantText && text(m) === transcript.assistantText)
		);
		if (user) result[result.indexOf(user)] = user = { ...user, voice: true };
		else if (transcript.userText) {
			user = {
				id: `${transcript.id}:user`,
				role: 'user',
				voice: true,
				partial: !transcript.userFinal,
				parts: [{ type: 'text', text: transcript.userText }]
			};
			const before = reply
				? result.indexOf(reply)
				: result.findIndex((m) => newer(m) && m.role === 'assistant' && !m.id.startsWith('voice:'));
			result.splice(before < 0 ? result.length : before, 0, user);
		}
		if (reply) {
			result[result.indexOf(reply)] = reply = { ...reply, voice: true };
			if (user && result.indexOf(user) > result.indexOf(reply)) {
				result.splice(result.indexOf(user), 1);
				result.splice(result.indexOf(reply), 0, user);
			}
		} else if (transcript.assistantText) {
			const assistant: ChatMessage = {
				id: `${transcript.id}:assistant`,
				role: 'assistant',
				voice: true,
				partial: !transcript.assistantFinal,
				parts: [{ type: 'text', text: transcript.assistantText }]
			};
			const at = user ? result.indexOf(user) + 1 : result.length;
			result.splice(at, 0, assistant);
		}
	}
	return result;
}
