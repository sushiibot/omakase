<script lang="ts">
	import ApprovalInline from '$lib/features/chat/components/approval-inline.svelte';
	import ApprovalCard from '$lib/features/agents/components/approval-card.svelte';
	import ToolConfirmation from '$lib/features/chat/components/tool-confirmation.svelte';
	import VoiceCallBar from '$lib/features/chat/components/voice-call-bar.svelte';
	import type { AgentRecord, AgentRequest } from '$lib/features/agents/types';
	import type { AskView } from '$lib/features/chat/types';
	import { pending } from './api.svelte';

	let fired = $state<string[]>([]);
	const log = (what: string) => () => fired.push(what);
	const agent = {
		id: 'ag',
		machineId: 'm',
		machineName: 'Desktop',
		rootId: 'r',
		provider: 'codex',
		title: 'Fix the build',
		conversationId: 'main',
		createdAt: '2026-10-13T00:00:00Z',
		updatedAt: '2026-10-13T00:00:00Z'
	} satisfies AgentRecord;
	const request: AgentRequest = {
		id: 1,
		description: 'Run bun test',
		decisions: ['accept', 'decline'],
		detail: { kind: 'command', command: 'bun test' }
	} as AgentRequest;
	const ask = (askId: string, choices: string[]): AskView => ({
		askId,
		question: 'Run it?',
		choices,
		state: 'pending'
	});
	const confirmation = { tool: 'bash', input: 'rm -rf build' };
</script>

<div class="flex flex-col gap-6 p-4">
	<div data-surface-probe="inline">
		<ApprovalInline
			pending={pending('INLINEINLINEINLI', 'send_email')}
			onapprove={log('inline:approve')}
			ondeny={log('inline:deny')}
		/>
	</div>
	<div data-surface-probe="card">
		<ApprovalCard {request} {agent} ondecide={(d) => fired.push(`card:${d}`)} />
	</div>
	<div data-surface-probe="confirm-no-yes">
		<ToolConfirmation
			ask={ask('c1', ['No', 'Yes'])}
			{confirmation}
			onanswer={(a) => fired.push(`c1:${a}`)}
		/>
	</div>
	<div data-surface-probe="confirm-yes-no">
		<ToolConfirmation
			ask={ask('c2', ['Yes', 'No'])}
			{confirmation}
			onanswer={(a) => fired.push(`c2:${a}`)}
		/>
	</div>
	<div data-surface-probe="voice">
		<VoiceCallBar
			state="speaking"
			mode="turns"
			muted={false}
			agentWorking={false}
			error={null}
			onmute={log('voice:mute')}
			onstop={log('voice:end')}
			ondetails={log('voice:details')}
			oninterrupt={log('voice:interrupt')}
		/>
	</div>
	<p data-fired>{fired.join(',')}</p>
</div>
