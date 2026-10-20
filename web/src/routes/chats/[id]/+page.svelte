<script lang="ts">
	import { INSPECTOR_BREAKPOINT } from '$lib/ui/breakpoints';
	import { AgentCards } from '$lib/features/agents';
	import { followAgentLink, openAgentFrom, openAgentPage } from '$lib/core/nav/agent-link';
	import { getWorkspace } from '$lib/ui/workspace/context';
	const workspaceLayout = getWorkspace();
	import { PanelButton, TaskWorkspace, type PanelTab } from '$lib/features/tasks';
	import { BrowserPreview, BrowserPreviewPanel } from '$lib/features/browser';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { backTo } from '$lib/core/nav/back';
	import { leaveSheet, routedSheet } from '$lib/core/nav/sheet';
	import { leaveMessageLink } from '$lib/core/nav/message-link';
	import { offlineBrowsing } from '$lib/core/storage/offline.svelte';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import {
		modelsStore,
		conversationMedia,
		conversationContext,
		VoiceControl,
		Voice,
		VoiceCallBar,
		channelActivity,
		type ChatSheet,
		type FileRef,
		linkProps,
		linkTarget,
		liveBlocksStore
	} from '$lib/features/chat';
	import {
		ThreadScreen,
		threadMessages,
		threadsStore,
		type ThreadSheet
	} from '$lib/features/threads';

	const threads = threadsStore();
	const goBack = backTo(resolve('/chats'));
	const id = $derived(page.params.id ?? '');
	const remote = $derived(threads.thread(id));
	const detail = $derived(remote.data);
	const store = $derived(detail ? threads.chat(detail) : null);
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
				openPanel: (agent) => {
					panelTab = 'agents';
					panelAgent = agent;
				}
			})
		);
	});
	const browser = $derived(new BrowserPreview(id));
	const voiceSheet = routedSheet('voice');
	const voice = new Voice(() => (detail && store ? threadMessages(detail, store.messages) : []));
	let voiceActive = $state(false);
	const dictation = conversationMedia({
		conversationId: () => id,
		store: () => store,
		browser: () => browser,
		expanded: () => browserSheet.open
	});
	let viewer = $state<FileRef | undefined>();
	let now = $state(Date.now());

	$effect(() => {
		const r = remote;
		untrack(() => void r.ensure());
		return r.watch();
	});
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(t);
	});
	$effect(() => {
		const s = store;
		if (!s) return;
		const visible = workspaceLayout?.contentVisible ?? true;
		untrack(() => s.setViewing(visible));
		return () => s.setViewing(false);
	});

	const models = $derived(modelsStore(id));
	let modelRole = $state<'main' | 'fallback'>('main');

	type AnySheet = ChatSheet | Exclude<ThreadSheet, 'branch'>;
	const ids: AnySheet[] = [
		'attachments',
		'commands',
		'new',
		'viewer',
		'model',
		'context',
		'context-boundary',
		'thread-memory',
		'thread-close',
		'thread-settings'
	];
	const sheets = Object.fromEntries(ids.map((s) => [s, routedSheet(s)])) as Record<
		AnySheet,
		ReturnType<typeof routedSheet>
	>;
	const sheet = $derived(ids.find((s) => sheets[s].open));
	conversationContext({ store: () => store, models: () => models, sheet: () => sheet });
	const closeSheet = () => {
		if (sheet) sheets[sheet].close();
	};

	async function closeThread() {
		if (!(await threads.close(id))) return;
		await leaveSheet(sheet ? sheets[sheet] : undefined);
	}
</script>

<svelte:head><title>{detail?.summary.title ?? 'Channel'} · sushii</title></svelte:head>

{#snippet agents(calls: string[])}<AgentCards
		conversationId={id}
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
		conversation={id}
		open={voiceSheet.open}
		onopen={() => voiceSheet.openWith()}
		onclose={() => voiceSheet.close()}
		onstarting={() => dictation.cancel()}
		onactive={(active) => (voiceActive = active)}
	/>
{/snippet}

<TaskWorkspace
	conversationId={id}
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
		<ThreadScreen
			{remote}
			{detail}
			{now}
			{sheet}
			busy={threads.busy}
			error={threads.error}
			sendable={threads.canSend}
			back={{ href: resolve('/chats'), label: 'Back to Conversations', onclick: goBack }}
			writeHref={(w) => resolve('/memory/writes/[id]', { id: w })}
			memoryHref={resolve('/memory/writes')}
			chat={store
				? {
						headerActions: taskActions,
						...linkProps(store, linkTarget(page.url.searchParams), leaveMessageLink),
						approvals: store.approvals,
						messages: voice.project(threadMessages(detail!, store.messages)),
						dictationTranscript:
							dictation.state === 'recording' || dictation.state === 'transcribing'
								? dictation.partialText ||
									(dictation.state === 'recording' ? 'Listening…' : 'Transcribing…')
								: '',
						history: store.history,
						hasOlder: store.hasOlder,
						olderLoading: store.olderLoading,
						approvalSubmitting: store.trayPhase === 'submitting',
						olderError: store.olderError,
						running: store.running,
						stopping: store.stopping,
						draft: store.draft,
						photos: store.photos,
						reference: store.draftRef?.view ?? null,
						onremovereference: () => store.setDraftRef(null),
						quotaFull: store.quotaFull,
						dictation: {
							state: dictation.state,
							seconds: dictation.seconds,
							micLevel: dictation.micLevel,
							error: dictation.error,
							disabled: voiceActive
						},
						onspeak:
							voice.state === 'idle' && dictation.state === 'idle'
								? (m) => void voice.readAloud(m)
								: undefined,
						readingId: voice.reader.messageId,
						readingState: voice.reader.state,
						readingError: voice.reader.error,
						ondictate: () => {
							voice.reader.stop();
							dictation.toggle();
						},
						ondictatesend: () => dictation.sendNow(),
						voice: voiceControls,
						voiceStatus,
						browserPreview,
						agentActivity: agents,
						voiceActive: voice.state !== 'idle',
						voiceHasContent: voice.state !== 'idle' && !!(voice.userText || voice.assistantText),
						usage: store.usage,
						models: models.remote.data ?? null,
						modelPicking: models.picking,
						modelError: models.error,
						modelRole,
						modelQuery: models.query,
						modelResults: models.results,
						modelSearching: models.searching,
						modelSearchError: models.searchError,
						onmodelrole: (r) => (modelRole = r),
						onmodelquery: (q) => models.setQuery(q),
						onpickmodel: (alias, role) =>
							void models.pick(alias, role).then((ok) => ok && closeSheet()),
						connection:
							!pwa.online || offlineBrowsing.unreachable
								? { kind: 'offline' }
								: store.workspace === 'offline'
									? { kind: 'agent-offline' }
									: store.reset
										? { kind: 'reset' }
										: undefined,
						toast: store.toast,
						announce: store.announce,
						viewer,
						contextBoundaryId: sheets['context-boundary'].arg,
						onopensheet: (s, arg) => {
							if (s === 'model') {
								models.refresh();
								modelRole = 'main';
							}
							sheets[s].openWith(arg);
						},
						onclosesheet: closeSheet,
						onopenfile: (f) => {
							viewer = f;
							sheets.viewer.openWith();
						},
						ondraft: (v) => store.setDraft(v),
						onsend: () => void store.send(store.draft),
						onstop: () => store.stopTurn(),
						oncommand: async (c) => {
							await store.command(c);
							models.refresh();
						},
						onattach: (files) => void store.attach(files),
						onremovephoto: (p) => store.removePhoto(p),
						onretryphoto: (p) => store.retryPhoto(p),
						onloadolder: () => store.loadOlder(),
						onretryhistory: () => store.retryHistory(),
						onretrysend: (m) => store.retry(m),
						onsteersend: (m) => store.steerNow(m),
						ondeletesend: (m) => void store.discard(m),
						onrewind: (id, text) => store.rewind(id, text),
						onanswer: (askId, answer) => store.answer(askId, answer),
						onreply: (text) => void store.send(text, [], { preserveComposer: true }),
						live: liveBlocksStore(),
						onapprove: (nonce, location) => void store.decide(nonce, 'approve', location),
						ondeny: (nonce) => void store.decide(nonce, 'deny')
					}
				: undefined}
			onopensheet={(s) => {
				threads.clearError();
				if (s !== 'branch') sheets[s].openWith();
			}}
			onclosesheet={closeSheet}
			onclose={() => void closeThread()}
			onrename={async (title) => {
				if (await threads.rename(id, title)) await leaveSheet(sheets['thread-settings']);
			}}
			onreopen={() => void threads.reopen(id)}
			onretry={() => void remote.refetch()}
		/>
	{/snippet}
</TaskWorkspace>
