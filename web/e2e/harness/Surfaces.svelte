<script lang="ts">
	import ApprovalInline from '$lib/features/chat/components/approval-inline.svelte';
	import ApprovalCard from '$lib/features/agents/components/approval-card.svelte';
	import ToolConfirmation from '$lib/features/chat/components/tool-confirmation.svelte';
	import VoiceCallBar from '$lib/features/chat/components/voice-call-bar.svelte';
	import VoicePanel from '$lib/features/chat/components/voice-panel.svelte';
	import AskCard from '$lib/features/chat/components/ask-card.svelte';
	import * as Sheet from '$lib/ui/sheet';
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
	const pushInput = `owner/repo → main\n${'abc1234'.padEnd(40, '0')}\nFix the login redirect`;
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
	<div data-surface-probe="push">
		<ToolConfirmation
			ask={ask('p1', ['No', 'Yes'])}
			confirmation={{ tool: 'github_push', input: pushInput }}
			onanswer={(a) => fired.push(`push:${a}`)}
		/>
	</div>
	<div data-surface-probe="ask">
		<AskCard
			ask={ask('a1', ['Tomorrow', 'Next week', 'Later this month'])}
			onanswer={(a) => fired.push(`ask:${a}`)}
		/>
	</div>
	<!-- The panel lives in a sheet; its title needs the dialog root, not an open dialog. -->
	<Sheet.Root>
		<div data-surface-probe="voice-panel">
			<VoicePanel
				state="speaking"
				mode="turns"
				models={[]}
				provider=""
				loading={false}
				error={null}
				muted={false}
				agentWorking={false}
				userText=""
				assistantText=""
				seconds={42}
				micReady
				onprovider={() => {}}
				onstart={log('panel:start')}
				onstop={log('panel:end')}
				onmute={log('panel:mute')}
				onretry={() => {}}
				onclose={() => {}}
				oninterrupt={log('panel:interrupt')}
			/>
		</div>
	</Sheet.Root>
	<p data-fired>{fired.join(',')}</p>
</div>
