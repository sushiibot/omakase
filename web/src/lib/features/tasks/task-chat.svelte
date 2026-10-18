<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { getWorkspace } from '$lib/ui/workspace/context';
	import { ChatScreen, chatStore, createHttpChatApi } from '$lib/features/chat';
	import { AgentCards, type AgentRecord } from '$lib/features/agents';
	import { createHub } from '$lib/core/realtime/hub.svelte';
	import { fetchSse } from '$lib/core/realtime/transport';
	import { taskChatDeps } from './tasks.svelte';
	import type { TaskRecord } from './types';
	let {
		task,
		viewing = true,
		headerActions,
		focusTurn,
		focusAsk,
		focusApproval,
		onopenagent
	}: {
		task: TaskRecord;
		viewing?: boolean;
		headerActions?: Snippet;
		focusTurn?: string;
		focusAsk?: string;
		focusApproval?: string;
		/** Opens a coding agent this conversation started. */
		onopenagent?: (agent: AgentRecord, event: MouseEvent) => void;
	} = $props();
	const workspace = getWorkspace();
	const id = untrack(() => task.workConversationId!);
	const base = untrack(() => `/tasks/${task.id}/chat`);
	const store = chatStore(
		`thread:${id}`,
		untrack(() => taskChatDeps(task)) ?? {
			approvals: true,
			hub: createHub({
				transport: fetchSse({ url: `/api${base}/stream` }),
				carries: `thread:${id}`
			}),
			api: createHttpChatApi(base)
		}
	);
	$effect(() => {
		const visible = viewing && (workspace?.contentVisible ?? true);
		untrack(() => store.setViewing(visible));
		return () => store.setViewing(false);
	});
</script>

{#snippet agents(calls: string[])}<AgentCards
		conversationId={id}
		toolCallIds={calls}
		onopen={(agent, event) => onopenagent?.(agent, event)}
	/>{/snippet}

<ChatScreen
	title={task.title}
	agentActivity={agents}
	{headerActions}
	{focusTurn}
	{focusAsk}
	{focusApproval}
	messages={store.messages}
	history={store.history}
	hasOlder={store.hasOlder}
	olderLoading={store.olderLoading}
	olderError={store.olderError}
	running={store.running}
	stopping={store.stopping}
	draft={store.draft}
	photos={store.photos}
	onattach={(files) => void store.attach(files)}
	onremovephoto={(id) => store.removePhoto(id)}
	onretryphoto={(id) => store.retryPhoto(id)}
	approvals={store.approvals}
	approvalSubmitting={store.trayPhase === 'submitting'}
	toast={store.toast}
	placeholder={store.running ? 'Steer this task…' : 'Follow up on this task…'}
	ondraft={(text) => store.setDraft(text)}
	onsend={() => void store.send(store.draft)}
	onstop={() => void store.stopTurn()}
	onloadolder={() => store.loadOlder()}
	onanswer={(id, answer) => store.answer(id, answer)}
	onapprove={(nonce) => store.decide(nonce, 'approve')}
	ondeny={(nonce) => store.decide(nonce, 'deny')}
	onretryhistory={() => void store.retryHistory()}
	onretrysend={(id) => store.retry(id)}
	onsteersend={(id) => store.steerNow(id)}
	ondeletesend={(id) => void store.discard(id)}
/>
