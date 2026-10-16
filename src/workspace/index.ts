import { ArtifactStore } from "./artifacts.ts";
import { OwnerRequests } from "./ownerRequests.ts";
import { exitAfterBackoff } from "../crashBackoff.ts";
import { TaskStore } from "./taskStore.ts";
import { BrowserManager, localBrowserDriver } from "./browser.ts";
import { runsStopParams, RPC_METHODS } from "../orchestration/contracts.ts";
// First: initialises OTel (when OTEL_EXPORTER_OTLP_ENDPOINT is set) before anything creates spans.
import { otelSDK } from "../telemetry.ts";
import { ConnectorDecisions } from "./connectorDecisions.ts";
import { ConnectorManager } from "./connectors.ts";
import { join } from "node:path";
import { NotConnectedError, OrchestrationClient } from "../orchestration/transport/client.ts";
import { getLogger } from "../logger.ts";
import { WorkspaceConfigError, economyOf, loadWorkspaceConfig, taskRulesOf, type WorkspaceConfig } from "./config.ts";
import { TopicSessions } from "./topicSessions.ts";
import { PersonalSession } from "./personalSession.ts";
import { compactSession, conversationContext, compactionTrigger, createPiChatSessionFactory, idleRotateMs, loadedContextFiles, recapSession, reloadContext, sessionModelLabel } from "./piChatSession.ts";
import { ModelChoice } from "./modelChoice.ts";
import { commandHandlers } from "./commands.ts";
import { readModelCosts } from "./modelCosts.ts";
import { TASK_PATHS, renderTasksCommand, runTaskReview } from "./tasks.ts";
import { MEMORY_PATHS, commitHome, scaffoldHome } from "./home.ts";
import { memoryCatalogSignature, memoryFilesSignature, sessionFlushRanThisCycle, writeResetHandoff } from "./memoryFlush.ts";
import { scanMemoryForSecrets } from "./memoryGuard.ts";
import { RunLog, recordRotation } from "./runLog.ts";
import { HistoryWriter, recordHistory } from "./history.ts";
import { memoryEvidence } from "./memoryEvidence.ts";
import { createConsolidationJob, waitIdle } from "./consolidation.ts";
import { ToolStubs, TOOL_TIMEOUT_MS } from "./toolStubs.ts";
import { startExternalFilesBridge } from "./externalFiles.ts";
import { GitHubCredentials } from "./githubCredentials.ts";
import { AuthLogin, ReauthNotifier, piChatGptLogin } from "./authLogin.ts";
import { BackendSelector } from "./chatgptFallback.ts";
import { SubagentHost } from "./subagents/host.ts";
import { MainTurnTracker } from "./subagents/turnTracker.ts";
import { Scheduler, jobAlertText, jobAlertWire } from "./scheduler.ts";
import { wireProactiveJobs } from "./proactive.ts";
import { ulid } from "./ulid.ts";
import { ChatExportReader, chatExportHandlers } from "./chatExport.ts";
import { UPLOADS_DIR } from "./inboundImages.ts";
import { notifyRunChanges, runsHandlers } from "./runsRpc.ts";
import { memoryHandlers } from "./memoryFiles.ts";
import { historyHandlers } from "./historyFiles.ts";
import { HistorySearch, historySearchHandlers } from "./historySearch.ts";
import { DurableState } from "../agentRuntime/durableState.ts";
import { WakeupManager, deliverScheduledCheck } from "./wakeups.ts";
import { readJson } from "./files.ts";
import { applyRegisteredOwnerName, loadOwnerName, ownerHandlers } from "./owner.ts";
import { AgentResults } from "./agentResults.ts";

const log = getLogger("workspace");

function loadConfigOrExit(): WorkspaceConfig {
  try {
    return loadWorkspaceConfig();
  } catch (err) {
    if (err instanceof WorkspaceConfigError) {
      console.error(`workspace: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const config = loadConfigOrExit();
  // This is the OpenRouter key; Pi's built-in openai provider would otherwise send it to api.openai.com
  // whenever no ChatGPT login is stored.
  delete process.env.OPENAI_API_KEY;
  await scaffoldHome(config.home);
  loadOwnerName(config);
  // A changed name reaches the live sessions between turns; until then they keep the one they started with.
  const ownerChanged = () => topicsRef?.requestContextReload();
  // One instance for the whole process: later subagent and job runners record through it too.
  const runLog = new RunLog(config.stateDir, { warn: (obj, msg) => log.warn(obj, msg) });
  const orphans = runLog.reconcileOrphans();
  if (orphans) log.warn({ orphans }, "closed runs left open by a previous process");
  const historyLog = getLogger("workspace.history");
  const evidence = memoryEvidence(config.home, config.agentDir);
  const history = new HistoryWriter({ home: config.home, agentDir: config.agentDir, tz: config.tz,
    onWritten: () => { void evidence.refresh().catch(err => historyLog.warn({ err }, "memory evidence indexing failed; retrieval will retry")); },
  });
  let client: OrchestrationClient | null = null;
  const taskStore = new TaskStore(config.stateDir, config.home);
  const recordedRuns = notifyRunChanges(recordHistory(runLog, history, historyLog), (method, params) => client?.notify(method, params), config.principalId, log);
  taskStore.setRunActivity(id => recordedRuns.getRun(id)?.status === "running");
  const runs: import("./runLog.ts").RunRecorder = {
    startRun(input) {
      const id = recordedRuns.startRun(input);
      const task = !input.parentRunId && taskStore.list().find(t => t.workConversationId === input.conversationId);
      if (task) taskStore.attachRun(task.id, id, "Sushii");
      return id;
    },
    endRun(id, end) { recordedRuns.endRun(id, end); taskStore.settleRun(id, end.status, end.resultSummary); },
    listRuns: q => recordedRuns.listRuns(q), getRun: id => recordedRuns.getRun(id),
  };
  const toolStubs = new ToolStubs({
    principalId: config.principalId,
    ownerName: () => config.ownerName,
    request: (method, params, timeoutMs) => (client ? client.request(method, params, { timeoutMs }) : Promise.reject(new NotConnectedError())),
  });
  // Late-bound: the subagent watch leases a pre-push hook install, and subagents take these credentials.
  let watchRef: SubagentHost["watch"] | null = null;
  const github = new GitHubCredentials({
    principalId: config.principalId,
    home: config.home,
    askpassPath: join(config.stateDir, "git-askpass.sh"),
    request: (method, params, timeoutMs) => (client ? client.request(method, params, { timeoutMs }) : Promise.reject(new NotConnectedError())),
    leaseWrite: (paths) => watchRef?.mainWrite(paths) ?? (() => {}),
  });
  // The one backend selector: main, subagents, jobs and the auto-mode judge all start their calls on its
  // current backend, so a ChatGPT limit or auth failure anywhere moves them all to OpenRouter together.
  // Late-bound: the selector reports auth failures while the first session is built, before these exist.
  let reauth: ReauthNotifier | null = null;
  const selector = new BackendSelector({
    primaryEnabled: config.provider === "chatgpt",
    onAuthFailure: () => {
      try {
        reauth?.notify();
      } catch (err) {
        log.warn({ err }, "failed to send the ChatGPT re-auth notice");
      }
    },
  });
  // After the selector (its ChatGPT switch follows the deployed provider, not a pinned choice), before any
  // session or runner reads the config: a saved `!model` choice rewrites its model fields.
  const choice = new ModelChoice(config, config.stateDir);
  const browsers = new BrowserManager(config.stateDir, localBrowserDriver(config.home));
  await browsers.recover();
  const turns = new MainTurnTracker();
  // Late-bound: main runs start only after the session exists.
  let personalTurn: PersonalSession | null = null;
  const notify = (method: string, params: unknown) => {
    turns.observe(method, params);
    client?.notify(method, params);
  };
  // Late-bound: background results only arrive after personal.start().
  let personalRef: PersonalSession | null = null;
  let topicsRef: TopicSessions | null = null;
  const ownerRequests = new OwnerRequests();
  const durableState = new DurableState(config.stateDir);
  const wakeups = new WakeupManager({
    store: durableState,
    stateDir: config.stateDir,
    timeZone: config.tz,
    tasks: taskStore,
    ready: () => client?.connected ?? false,
    conversationExists: id => id === "main" || !!readJson<Record<string, unknown>>(join(config.stateDir, "topics.json"))?.[id],
    deliver: (check, wake) => {
      if (!topicsRef) throw new Error("Topic sessions are not ready.");
      return deliverScheduledCheck(topicsRef, taskStore, check, wake, async id => {
        const entry = toolStubs.entry("task_manage");
        if (!entry) throw new Error("Task controls are unavailable.");
        const tool = toolStubs.definition(entry, { agentId: "main", agentName: "scheduled-check", origin: check.origin });
        await tool.execute(`prepare:${check.id}`, { action: "prepare", id }, undefined, undefined, {} as never);
      });
    },
    warn: (err, message) => log.warn({ err }, message),
  });
  await wakeups.open();
  const subagents = new SubagentHost({
    config,
    tasks: taskStore,
    runs,
    selector,
    toolStubs,
    github,
    browsers,
    notify,
    currentTurn: () => turns.current(),
    wake: (r, consumed) => (topicsRef ?? personalRef)?.wake({ id: r.runId, text: r.text, origin: r.origin, onConsumed: consumed }),
  });
  watchRef = subagents.watch;
  taskStore.setProjectionLease(() => subagents.watch.mainWrite(["TASKS.md"]));
  const connectors = new ConnectorManager(config.agentDir, undefined, undefined, new ConnectorDecisions(config, runs).classify);
  await connectors.start();
  const personalOptions = {
    ownerName: () => config.ownerName,
    boundaryReport: { home: config.home, context: loadedContextFiles },
    principalId: config.principalId,
    model: config.model,
    stateDir: config.stateDir,
    durableState,
    ownerRequests,
    conversationId: "main",
    tz: config.tz,
    uploads: { dir: join(config.home, UPLOADS_DIR) },
    factory: createPiChatSessionFactory(config, { runs, tasks: taskStore, wakeups, ownerRequests, toolStubs, selector, subagents, choice, github, connectors, browsers, parentTurn: () => { const turnId = personalTurn?.currentTurnId(); return turnId ? turns.get(turnId) : null; }, mainTurnId: () => personalTurn?.currentTurnId() }),
    memory: {
      compactionTrigger,
      reload: reloadContext,
      commit: (message) => {
        const flagged = scanMemoryForSecrets(config.home);
        if (flagged.length) log.warn({ files: flagged }, "memory files hold something secret-shaped; committing anyway");
        return commitHome(message, { home: config.home, paths: MEMORY_PATHS });
      },
      signature: () => memoryFilesSignature(config.home),
      contextSignature: () => memoryCatalogSignature(config.home),
      handoff: (session, outcome) => {
        const end = subagents.watch.mainWrite(["memory"]);
        try {
          writeResetHandoff(config.home, session.messages, outcome);
        } finally {
          end();
        }
      },
      flushRanThisCycle: sessionFlushRanThisCycle,
    },
    context: {
      compact: compactSession,
      recap: async (session, signal) => (await recapSession(session, signal))?.text ?? null,
      idleRotateMs: (session) => idleRotateMs(session, config),
      rotateTokens: economyOf(config).idleRotateTokens,
      busy: () => subagents.isBusy(),
      onRotated: (r) => {
        try {
          recordRotation(runs, r);
        } catch (err) {
          log.warn({ err }, "failed to record the rotation in the run log");
        }
      },
      onSessionSummary: (s) => history.writeSession(s),
    },
    transport: {
      request: (method, params, timeoutMs) => (client ? client.request(method, params, { timeoutMs }) : Promise.reject(new NotConnectedError())),
      notify,
      isConnected: () => client?.connected ?? false,
    },
  } satisfies import("./personalSession.ts").PersonalSessionOptions;
  const personal = new PersonalSession(personalOptions);
  personalTurn = personal;
  const authLogin = new AuthLogin({
    principalId: config.principalId,
    login: piChatGptLogin({ agentDir: config.agentDir, cwd: config.home }),
    deliver: (d) => personal.deliverOutOfBand(d),
    model: config.chatgptModel,
    onLoggedIn: () => selector.reset(),
  });
  reauth = new ReauthNotifier({ stateDir: config.stateDir, deliver: (d) => personal.deliverOutOfBand(d), suppressed: () => authLogin.isPending });
  await personal.start();
  personalRef = personal;
  const commands = commandHandlers({
    principalId: config.principalId,
    compact: () => personal.compactNow(),
    choice,
    currentModel: () => (personal.chatSession ? sessionModelLabel(personal.chatSession) : null),
    fallbackUntil: () => selector.coolingDownUntil,
    context: conversationId => conversationContext(topicsRef ? topicsRef.chatSessionFor(conversationId) : personal.chatSession),
    costs: conversationId => readModelCosts({
      stateDir: config.stateDir,
      timeZone: config.tz,
      sessionFile: topicsRef ? topicsRef.sessionFileFor(conversationId) : personal.currentSessionFile || null,
    }),
    tasks: (arg) => renderTasksCommand(config.home, taskRulesOf(config), new Date(), arg),
  });
  const topics = new TopicSessions({
    principalId: config.principalId, stateDir: config.stateDir, main: personal,
    command: p => commands["chat/command"]!(p),
    create: id => {
      let topic: PersonalSession;
      topic = new PersonalSession({
        ...personalOptions,
        stateDir: join(config.stateDir, "topics", id),
        conversationId: id,
        factory: createPiChatSessionFactory(config, { runs, tasks: taskStore, wakeups, ownerRequests, toolStubs, selector, subagents, choice, github, connectors, browsers, parentTurn: () => { const turnId = topic.currentTurnId(); return turnId ? { turnId, origin: { surface: "web", conversationId: id } } : null; }, origin: { surface: "web", conversationId: id }, sessionDir: join(config.agentDir, "topics", id), agentName: `topic:${id}`, mainTurnId: () => topic.currentTurnId() }),
        context: { ...personalOptions.context, busy: () => subagents.isBusy({ surface: "web", conversationId: id }) },
      });
      return topic;
    },
  });
  topicsRef = topics;
  await topics.restore();
  subagents.redeliverPending();
  const agentResults = new AgentResults({
    stateDir: config.stateDir,
    principalId: config.principalId,
    conversationExists: id => id === "main" || !!readJson<Record<string, unknown>>(join(config.stateDir, "topics.json"))?.[id],
    wake: async (conversationId, wake) => (await topics.session({ surface: "web", conversationId })).wake(wake),
    warn: (err, message) => log.warn({ err }, message),
  });
  agentResults.resume();
  const scheduler = new Scheduler({
    stateDir: config.stateDir,
    at: config.consolidateAt,
    tz: config.tz,
    log: getLogger("workspace.scheduler"),
    onJobAlert: (alert) => personal.deliverAlert(jobAlertWire(alert), jobAlertText(alert)),
  });
  const consolidation = createConsolidationJob(config, { runs, selector, live: topics });
  // Its memory and task writes are main-side: the subagents' protected watch must not undo them.
  // Two idle waits and a model call can each take 10 min, so the default max runtime would flag a normal slow run.
  let memoryRun: ReturnType<typeof consolidation.run> | undefined;
  const runMemory: typeof consolidation.run = (ctx) => {
    if (memoryRun) return memoryRun;
    memoryRun = subagents.whileMainWrites(() => consolidation.run(ctx), ["USER.md", "MEMORY.md", "DREAMS.md", "memory", "TASKS.md", "tasks"])
      .finally(() => { memoryRun = undefined; });
    return memoryRun;
  };
  scheduler.register({ ...consolidation, maxRunMs: 60 * 60_000, run: runMemory });
  // Coalesce extraction after chat activity; immediate recall uses the source index and never waits for this.
  scheduler.register({ name: "memory-capture", schedule: { when: { kind: "every", minutes: 5 } }, maxRunMs: 60 * 60_000, run: runMemory });
  wireProactiveJobs(scheduler, {
    evidenceTools: () => connectors.readOnlyTools(),
    connectedSources: async () => JSON.stringify(await connectors.discoverReadOnly()),
    scheduledChecks: () => `Pending one-time checks: ${JSON.stringify(wakeups.list().map(({ key, title, at, conversationId, taskId }) => ({ key, title, at, conversationId, taskId })))}. These items already have follow-ups. Do not repeat them unless something urgent changed. Reuse existing unanswered requests.`,
    config,
    runs,
    selector,
    toolStubs,
    deliver: (text, job) => personal.deliverOutOfBand({ kind: "proactive", text, job }),
    note: async (name, text) => {
      await personal.handleMessage({
        origin: { surface: "workspace", conversationId: "schedule" },
        principalId: config.principalId,
        messageId: `job:${name}:${ulid()}`,
        text,
        kind: "context",
        author: { id: "workspace", name: "scheduler" },
      });
    },
    review: (limiter) => () =>
      runTaskReview({
        home: config.home,
        stateDir: config.stateDir,
        rules: taskRulesOf(config),
        allow: (now) => limiter.check("task-review", 20 * 60 * 60_000, now) === "ok",
        record: (now) => limiter.record("task-review", now),
        ask: (question, choices, parse) => personal.askOwner(question, choices, parse),
        write: async (fn, message) => {
          // Between turns when possible: the agent may be editing TASKS.md; the edit itself is synchronous.
          if (!(await waitIdle(topics, 30 * 60_000))) log.warn("applying the stale review while the chat session is busy");
          await subagents.whileMainWrites(async () => fn(), ["TASKS.md", "tasks"]);
          await commitHome(message, { home: config.home, paths: TASK_PATHS });
          topics.requestContextReload();
        },
        warn: (obj, msg) => log.warn(obj, msg),
      }),
    onScheduleChange: () =>
      void commitHome("chore(schedule): update schedule.md", { home: config.home, paths: ["schedule.md"] }).catch((err) =>
        log.warn({ err }, "failed to commit schedule.md"),
      ),
  });
  void scheduler.start();

  client = new OrchestrationClient({
    url: config.orchUrl,
    runnerId: `workspace-${config.principalId}`,
    kind: "pi-workspace",
    secret: config.orchSecret,
    principalId: config.principalId,
    state: () => topics.state,
    handlers: {
      ...personal.handlers(),
      ...taskStore.handlers(config.principalId),
      ...browsers.handlers(config.principalId),
      ...connectors.handlers(config.principalId),
      ...chatExportHandlers({ principalId: config.principalId, reader: new ChatExportReader({ agentDir: config.agentDir }) }),
      // Session roots come from the host's own agent dir (process env set by the deploy), never from a run record.
      ...runsHandlers({ principalId: config.principalId, stateDir: config.stateDir, home: config.home, tz: config.tz, agentDirs: [config.agentDir] }),
      ...new ArtifactStore(config.stateDir).handlers(config.principalId),
      ...memoryHandlers({ home: config.home, principalId: config.principalId }),
      ...historyHandlers({ principalId: config.principalId, home: config.home, stateDir: config.stateDir }),
      ...historySearchHandlers(new HistorySearch({ principalId: config.principalId, home: config.home })),
      ...authLogin.handlers(),
      ...commands,
      ...topics.handlers(),
      ...ownerHandlers(config, ownerChanged),
      ...agentResults.handlers(),
      [RPC_METHODS.runsStop]: async (p: unknown) => {
        const q = runsStopParams.parse(p);
        if (q.principalId !== config.principalId) throw new Error("principal mismatch");
        return { stopped: subagents.stop(q.runId) };
      },
    },
    onRegistered: (result) => {
      if (result) applyRegisteredOwnerName(config, result, ownerChanged);
      toolStubs.update(result?.tools ?? []);
      topics.onRegistered(result?.features ?? []);
      void wakeups.start().catch(err => log.warn({ err }, "Wake-up startup poll failed"));
    },
  });

  const externalFiles = await startExternalFilesBridge(config.stateDir, async (args, runId) => {
    const run = runId ? runs.getRun(runId) : null;
    if (runId && (!run || run.status !== "running")) throw new Error("The requesting run is no longer active.");
    if (!client?.connected) throw new Error("The workspace is disconnected from the bot. Try again after it reconnects.");
    let raw: unknown;
    try {
      raw = await client.request(RPC_METHODS.toolCall, {
        principalId: config.principalId, callId: ulid(), name: "external_files", args,
        agentId: run?.parentRunId ? run.runId : "main", agentName: run?.agentName ?? "external-files-cli",
        ...(run?.parentRunId ? {parentRunId: run.parentRunId} : {}),
      }, {timeoutMs: TOOL_TIMEOUT_MS});
    } catch { throw new Error("External file connection interrupted. Inspect a write before retrying."); }
    const result = raw as import("../orchestration/contracts.ts").ToolCallResult;
    if (result?.ok === false) throw new Error(result.error);
    if (result?.ok !== true || typeof result.result !== "string") throw new Error("External file request failed.");
    return JSON.parse(result.result);
  });

  const shutdown = async (signal: string) => {
    log.info({ signal }, "workspace shutting down");
    await externalFiles.close();
    agentResults.close();
    client?.close();
    await wakeups.stop();
    // Children first: they record their runs and persist background results while main can still take them.
    await subagents.dispose();
    await Promise.all([scheduler.stop(), personal.dispose(), topics.dispose(), connectors.dispose()]);
    await browsers.dispose();
    await durableState.close();
    await otelSDK?.shutdown().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  log.info(
    {
      url: config.orchUrl,
      principalId: config.principalId,
      provider: config.provider,
      chatgptModel: config.chatgptModel,
      model: config.model,
      judge: config.autoMode ? { chatgpt: config.judgeChatgptModel, openrouter: config.judgeModel } : null,
    },
    "workspace starting",
  );
  await client.run();
}

main().catch(async (err) => {
  log.fatal({ err }, "workspace crashed");
  await exitAfterBackoff("workspace");
});
