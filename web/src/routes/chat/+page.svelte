<script lang="ts">
	import { INSPECTOR_BREAKPOINT } from '$lib/ui/breakpoints';
	import { getWorkspace } from '$lib/ui/workspace/context';
	const workspaceLayout = getWorkspace();
	import { TaskWorkspace, type PanelTab } from '$lib/features/tasks';
	import { AgentCards } from '$lib/features/agents';
	import { followAgentLink, openAgentFrom, openAgentPage } from '$lib/core/nav/agent-link';
	import { PanelButton } from '$lib/features/tasks';
	import { BrowserPreview, BrowserPreviewPanel } from '$lib/features/browser';
	import { tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { leaveSheet, routedSheet } from '$lib/core/nav/sheet';
	import { offlineBrowsing } from '$lib/core/storage/offline.svelte';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import { hub } from '$lib/core/realtime/hub.svelte';
	import {
		ChatScreen,
		ClearNotifications,
		chatStore,
		modelsStore,
		conversationMedia,
		conversationContext,
		VoiceControl,
		Voice,
		VoiceCallBar,
		channelActivity,
		type ChatSheet,
		type ChatMessage,
		type FileRef,
		liveBlocksStore
	} from '$lib/features/chat';
	import { BranchSheet, threadsStore } from '$lib/features/threads';
	import type { ConnectionState } from '$lib/ui/connection-banner.svelte';

	const store = chatStore();
	const threads = threadsStore();
	const branch = routedSheet('branch');
	const browserSheet = routedSheet('browser-preview');
	const taskPane = routedSheet('tasks');
	let panelTab = $state<PanelTab>('tasks');
	let panelAgent = $state<string | undefined>();
	$effect(() => {
		if (!page.url.searchParams.has('agent')) return;
		untrack(() =>
			followAgentLink({
				docked: () =>
					workspaceLayout?.docked ?? matchMedia(`(min-width: ${INSPECTOR_BREAKPOINT}px)`).matches,
				sheet: taskPane,
				openPanel: (id) => {
					panelTab = 'agents';
					panelAgent = id;
				}
			})
		);
	});
	const browser = new BrowserPreview('main');
	const voiceSheet = routedSheet('voice');
	const voice = new Voice(() => store?.messages ?? []);
	let voiceActive = $state(false);
	let branchFrom = $state<{ id: string; quote: string } | null>(null);
	let threadTitle = $state('');
	const s = store;
	let viewer = $state<FileRef | undefined>();
	let now = $state(Date.now());

	const sheets: Record<ChatSheet, ReturnType<typeof routedSheet>> = {
		attachments: routedSheet('attachments'),
		commands: routedSheet('commands'),
		new: routedSheet('new'),
		viewer: routedSheet('viewer'),
		model: routedSheet('model'),
		context: routedSheet('context'),
		'context-boundary': routedSheet('context-boundary')
	};
	const models = modelsStore();
	let modelRole = $state<'main' | 'fallback'>('main');
	// The transcript joins whatever is already in the box, like keyboard dictation. Kept on screen while
	// it runs, so a feature flip can't hide the stop control of a recording in progress.
	const dictation = conversationMedia({
		conversationId: () => 'main',
		store: () => store,
		browser: () => browser,
		expanded: () => browserSheet.open
	});
	const sheet = $derived((Object.keys(sheets) as ChatSheet[]).find((s) => sheets[s].open));
	const focusAsk = $derived(page.url.searchParams.get('ask') ?? undefined);
	conversationContext({ store: () => store, models: () => models, sheet: () => sheet });

	const connection = $derived.by((): ConnectionState | 'forbidden' | undefined => {
		if (!pwa.online || offlineBrowsing.unreachable) return { kind: 'offline' };
		if (hub.connection === 'forbidden') return 'forbidden';
		if (hub.connection === 'reconnecting' && hub.reconnectingSince !== null) {
			const secs = Math.floor((now - hub.reconnectingSince) / 1000);
			return { kind: 'reconnecting', elapsed: secs >= 5 ? `${secs}s` : undefined };
		}
		if (store.workspace === 'offline') return { kind: 'agent-offline' };
		if (store.reset) return { kind: 'reset' };
		return undefined;
	});

	$effect(() => {
		if (hub.connection !== 'reconnecting') return;
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});

	// `!model`, another device or a workspace restart can change the model: reload whenever the agent
	// comes (back) online, which also covers the first load.
	$effect(() => {
		if (s.workspace === 'online') untrack(() => models.refresh());
	});

	$effect(() => {
		const visible = workspaceLayout?.contentVisible ?? true;
		untrack(() => store.setViewing(visible));
		return () => store.setViewing(false);
	});

	// A push for a question opens /?ask=<id>; its card scrolls into view once history has it.
	$effect(() => {
		const askId = untrack(() => focusAsk);
		if (!askId) return;
		let done = false;
		return $effect.root(() => {
			$effect(() => {
				const item = store.items.find((i) => i.kind === 'ask' && i.askId === askId);
				if (!item || done) return;
				done = true;
				void tick().then(() =>
					document
						.querySelector(`[data-message-id="${CSS.escape(item.id)}"]`)
						?.scrollIntoView({ block: 'center' })
				);
			});
		});
	});

	function openSheet(next: ChatSheet, arg?: string) {
		if (next === 'model') {
			models.refresh();
			modelRole = 'main';
		}
		sheets[next].openWith(arg);
	}

	function closeSheet() {
		if (sheet) sheets[sheet].close();
	}

	const plain = (m: ChatMessage) =>
		m.parts
			.flatMap((p) => (p.type === 'text' ? [p.text] : []))
			.join(' ')
			.slice(0, 280);

	function openBranch(m: ChatMessage) {
		branchFrom = { id: m.sourceId ?? m.id, quote: plain(m) };
		threadTitle = '';
		threads.clearError();
		branch.openWith();
	}

	async function startThread(name: string) {
		const id = await threads.branch(branchFrom?.id ?? '', name);
		if (!id) return;
		await leaveSheet(branch);
		await goto(resolve('/chats/[id]', { id }));
	}
</script>

<svelte:head><title>Chat · sushii</title></svelte:head>

{#snippet agents(calls: string[])}<AgentCards
		conversationId="main"
		toolCallIds={calls}
		onopen={(agent, event) =>
			openAgentFrom(event, agent.id, {
				docked: workspaceLayout?.docked ?? false,
				sheet: taskPane,
				showInPanel: (id) => {
					panelTab = 'agents';
					panelAgent = id;
				}
			})}
	/>{/snippet}

{#snippet browserPreview()}
	<BrowserPreviewPanel
		status={browser.status}
		frame={browser.frame}
		hidden={browser.hidden}
		expanded={browserSheet.open}
		reconnecting={browser.reconnecting}
		stale={browser.stale}
		onhide={() => browser.hide()}
		onshow={() => browser.show()}
		onexpand={() => browserSheet.openWith()}
		onclose={() => browserSheet.close()}
		onframe={(seq) => browser.ack(seq)}
		controlling={browser.controlling}
		controlError={browser.controlError}
		oncontrol={(action, input) => browser.control(action, input)}
	/>
{/snippet}

{#snippet voiceStatus()}
	<VoiceCallBar
		phase={voice.phase}
		request={voice.userText}
		activity={store
			? channelActivity(store.messages, store.running, store.stopping, store.approvals)
			: null}
		onreview={() => {
			if (!store) return;
			const request = channelActivity(
				store.messages,
				store.running,
				store.stopping,
				store.approvals
			)?.request;
			if (!request) return;
			const url = new URL(page.url);
			url.searchParams.set(request.kind === 'ask' ? 'ask' : 'approve', request.id);
			void goto(url.pathname + url.search);
		}}
		mode={voice.mode}
		apiLabel={voice.apiLabel}
		turnBusy={voice.turnBusy}
		onturn={() => voice.finishTurn()}
		oninterrupt={() => voice.interrupt()}
		state={voice.state}
		muted={voice.muted}
		micLevel={voice.micLevel}
		seconds={voice.seconds}
		agentWorking={voice.agentWorking}
		error={voice.error}
		onmute={() => voice.mute()}
		onstop={() => voice.stop()}
		ondetails={() => voiceSheet.openWith()}
	/>
{/snippet}

{#snippet voiceControls()}
	<VoiceControl
		activity={store
			? channelActivity(store.messages, store.running, store.stopping, store.approvals)
			: null}
		{voice}
		open={voiceSheet.open}
		onopen={() => voiceSheet.openWith()}
		onclose={() => voiceSheet.close()}
		onstarting={() => dictation.cancel()}
		onactive={(active) => (voiceActive = active)}
	/>
{/snippet}

<TaskWorkspace
	open={taskPane.open}
	bind:tab={panelTab}
	bind:agentId={panelAgent}
	onopen={() => taskPane.openWith()}
	onclose={() => taskPane.close()}
	onnavigate={(href) => void openAgentPage(href, taskPane)}
>
	{#snippet children(toggle: () => void, count: number, waiting: number)}
		{#snippet taskActions()}<PanelButton
				{count}
				{waiting}
				open={taskPane.open}
				onclick={toggle}
			/>{/snippet}
		<ChatScreen
			headerActions={taskActions}
			contextBoundaryId={sheets['context-boundary'].arg}
			title={threads.list.data?.main.title ?? 'Sushii'}
			approvalSubmitting={s.trayPhase === 'submitting'}
			messages={voice.project(s.messages)}
			dictationTranscript={dictation.state === 'recording' || dictation.state === 'transcribing'
				? dictation.partialText ||
					(dictation.state === 'recording' ? 'Listening…' : 'Transcribing…')
				: ''}
			history={s.history}
			hasOlder={s.hasOlder}
			olderLoading={s.olderLoading}
			olderError={s.olderError}
			running={s.running}
			stopping={s.stopping}
			approvals={store.approvals}
			draft={s.draft}
			photos={s.photos}
			reference={s.draftRef?.view ?? null}
			onremovereference={() => s.setDraftRef(null)}
			quotaFull={s.quotaFull}
			usage={s.usage}
			models={models.remote.data ?? null}
			modelPicking={models.picking}
			modelError={models.error}
			{modelRole}
			modelQuery={models.query}
			modelResults={models.results}
			modelSearching={models.searching}
			modelSearchError={models.searchError}
			onmodelrole={(r) => (modelRole = r)}
			onmodelquery={(q) => models.setQuery(q)}
			dictation={{
				state: dictation.state,
				seconds: dictation.seconds,
				micLevel: dictation.micLevel,
				error: dictation.error,
				disabled: voiceActive
			}}
			onspeak={voice.state === 'idle' && dictation.state === 'idle'
				? (m) => void voice.readAloud(m)
				: undefined}
			readingId={voice.reader.messageId}
			readingState={voice.reader.state}
			readingError={voice.reader.error}
			ondictate={() => {
				voice.reader.stop();
				dictation.toggle();
			}}
			ondictatesend={() => dictation.sendNow()}
			voice={voiceControls}
			{voiceStatus}
			{browserPreview}
			agentActivity={agents}
			voiceActive={voice.state !== 'idle'}
			voiceHasContent={voice.state !== 'idle' && !!(voice.userText || voice.assistantText)}
			onpickmodel={(alias, role) => void models.pick(alias, role).then((ok) => ok && closeSheet())}
			{connection}
			commandsOffline={s.workspace === 'offline'}
			toast={s.toast}
			canInstall={pwa.canInstall}
			announce={s.announce}
			{focusAsk}
			focusTurn={page.url.searchParams.get('turn') ?? undefined}
			focusApproval={page.url.searchParams.get('approve') ?? undefined}
			{sheet}
			{viewer}
			onbranch={openBranch}
			onopensheet={openSheet}
			onclosesheet={closeSheet}
			onopenfile={(f) => {
				viewer = f;
				openSheet('viewer');
			}}
			ondraft={(v) => s.setDraft(v)}
			onsend={() => void s.send(s.draft)}
			onstop={() => s.stopTurn()}
			oncommand={async (c) => {
				await s.command(c);
				models.refresh();
			}}
			onattach={(files) => void s.attach(files)}
			onremovephoto={(id) => s.removePhoto(id)}
			onretryphoto={(id) => s.retryPhoto(id)}
			onloadolder={() => s.loadOlder()}
			onretryhistory={() => s.retryHistory()}
			onretrysend={(id) => s.retry(id)}
			onsteersend={(id) => s.steerNow(id)}
			ondeletesend={(id) => void s.discard(id)}
			onrewind={(id, text) => s.rewind(id, text)}
			onanswer={(askId, answer) => s.answer(askId, answer)}
			onreply={(text) => void s.send(text, [], { preserveComposer: true })}
			live={liveBlocksStore()}
			onapprove={(nonce, location) => void s.decide(nonce, 'approve', location)}
			ondeny={(nonce) => void s.decide(nonce, 'deny')}
			oninstall={() => pwa.install()}
			onreload={() => pwa.reload()}
		/>
	{/snippet}
</TaskWorkspace>
<ClearNotifications store={s} />

<BranchSheet
	open={branch.open}
	quote={branchFrom?.quote}
	bind:title={threadTitle}
	busy={threads.busy}
	error={threads.error}
	onstart={(name) => void startThread(name)}
	onclose={() => branch.close()}
/>
