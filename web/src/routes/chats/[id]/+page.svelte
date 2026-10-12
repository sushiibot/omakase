<script lang="ts">
	import { AgentsBar } from '$lib/features/agents';
	import { getWorkspace } from '$lib/ui/workspace/context';
	const workspaceLayout = getWorkspace();
	import { TaskWorkspace } from '$lib/features/tasks';
	import { Button } from '$lib/ui/button';
	import ListTodo from '@lucide/svelte/icons/list-todo';
	import { BrowserPreview, BrowserPreviewPanel } from '$lib/features/browser';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { backTo } from '$lib/core/nav/back';
	import { leaveSheet, routedSheet } from '$lib/core/nav/sheet';
	import { offlineBrowsing } from '$lib/core/storage/offline.svelte';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import {
		modelsStore,
		Dictation,
		VoiceControl,
		Voice,
		VoiceCallBar,
		channelActivity,
		type ChatSheet,
		type FileRef
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
	const browser = $derived(new BrowserPreview(id));
	$effect(() => {
		const preview = browser;
		return untrack(() => preview.start());
	});
	$effect(() => {
		const preview = browser;
		const expanded = browserSheet.open;
		untrack(() => preview.setExpanded(expanded));
	});
	const voiceSheet = routedSheet('voice');
	const voice = new Voice(() => (detail && store ? threadMessages(detail, store.messages) : []));
	let voiceActive = $state(false);
	const dictation = new Dictation((text, send) => {
		if (!store) return;
		const draft = store.draft.trimEnd();
		store.setDraft(draft ? `${draft} ${text}` : text);
		if (send) void store.send(store.draft);
	});
	$effect(() => {
		id;
		return () => dictation.cancel();
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
	$effect(() => {
		const m = models;
		untrack(() => void m.remote.ensure());
		return m.remote.watch();
	});

	const contextRevision = $derived(
		`${store?.running}:${JSON.stringify(store?.usage)}:${store?.items.findLast((i) => i.kind === 'divider')?.id}:${store?.items.findLast((i) => i.kind === 'assistant')?.id}`
	);
	$effect(() => {
		contextRevision;
		untrack(() => models.refresh());
	});
	$effect(() => {
		const m = models;
		const timer = setInterval(() => {
			if (!document.hidden && (store?.running || sheet === 'model' || sheet === 'context'))
				m.refresh();
		}, 15_000);
		return () => clearInterval(timer);
	});

	type AnySheet = ChatSheet | Exclude<ThreadSheet, 'branch'>;
	const ids: AnySheet[] = [
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
	$effect(() => {
		if (sheet !== 'model' && sheet !== 'context') return;
		const m = models;
		untrack(() => m.refresh());
	});
	const closeSheet = () => {
		if (sheet) sheets[sheet].close();
	};

	async function closeThread() {
		if (!(await threads.close(id))) return;
		await leaveSheet(sheet ? sheets[sheet] : undefined);
	}
</script>

<svelte:head><title>{detail?.summary.title ?? 'Channel'} · sushii</title></svelte:head>

{#snippet agents()}<AgentsBar conversationId={id} />{/snippet}

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
	onopen={() => taskPane.openWith()}
	onclose={() => taskPane.close()}
>
	{#snippet children(toggle: () => void, count: number)}
		{#snippet taskActions()}<Button
				variant="ghost"
				class="min-w-12 gap-1 px-2"
				aria-label="Tasks, {count} open"
				aria-expanded={taskPane.open}
				onclick={toggle}
				><ListTodo class="size-5" /><span class="text-sm">{count || 'Tasks'}</span></Button
			>{/snippet}
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
						focusTurn: page.url.searchParams.get('turn') ?? undefined,
						focusAsk: page.url.searchParams.get('ask') ?? undefined,
						focusApproval: page.url.searchParams.get('approve') ?? undefined,
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
						backgroundActivity: agents,
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
						onanswer: (askId, answer) => store.answer(askId, answer),
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
