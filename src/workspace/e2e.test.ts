import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionEvent, ExtensionAPI, PromptOptions, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { applySchema } from "../db/index.ts";
import { WorkspaceLinkStore } from "../db/workspaceLink.ts";
import { ORCH_CLOSE, RPC_METHODS, type ChatMessageParams, type ChatOrigin } from "../orchestration/contracts.ts";
import { OrchestrationClient } from "../orchestration/transport/client.ts";
import { OrchestrationServer, type WorkspaceHandler } from "../orchestration/transport/server.ts";
import { WorkspaceLink, type WorkspaceRpc } from "../orchestration/workspace/link.ts";
import type { Timers } from "../orchestration/workspace/progress.ts";
import { handleOwnerMessage, type OwnerRouterDeps } from "../orchestration/workspace/router.ts";
import {
  SurfaceRegistry,
  type AckKind,
  type ApprovalDecision,
  type ApprovalView,
  type AskView,
  type AuthPromptView,
  type InboundMessage,
  type ProgressFinal,
  type ProgressView,
  type ReplyView,
  type RouterNotice,
  type SurfaceActor,
  type SurfaceAdapter,
  type SurfaceCapabilities,
  type SurfaceMessageHandle,
} from "../orchestration/workspace/surface.ts";
import { PersonalSession, type ChatSession, type ChatSessionFactory } from "./personalSession.ts";
import { readWorkspaceState } from "./state.ts";
import { commandHandlers } from "./commands.ts";
import { ModelChoice } from "./modelChoice.ts";
import { ToolStubs } from "./toolStubs.ts";
import { AuthLogin, type LoginFn } from "./authLogin.ts";
import { BackendSelector } from "./chatgptFallback.ts";
import type { ToolEntry, ToolHosts } from "../core/contracts.ts";
import { WorkspaceTools, type AuditLog, type ToolCallAudit, type WorkspaceToolsOptions } from "../orchestration/workspace/tools.ts";
import { MainTurnTracker } from "./subagents/turnTracker.ts";
import { Scheduler } from "./scheduler.ts";
import { wireProactiveJobs } from "./proactive.ts";
import { RunLog } from "./runLog.ts";
import type { WorkspaceConfig } from "./config.ts";

// One process: real OrchestrationServer + WorkspaceLink + owner-message router on the bot side, real
// OrchestrationClient + PersonalSession on the workspace side. Only Pi and the chat surface are faked.

const P = "drk";
const OWNER = "owner-1";
const SECRET = "e2e-workspace-secret";
const MODEL = "test/model";
const SURFACE = "web";

// ── Fake Pi chat session ──────────────────────────────────────────────────────
// Idle prompt(): preflight, agent_start, user message, resolves at settle. Streaming prompt(): queues a steer.
// The test drives the run with tool() and reply(); abort() ends it as aborted.
class FakePi {
  isStreaming = false;
  isCompacting = false;
  prompts: string[] = [];
  steers: string[] = [];
  queue: string[] = [];
  customs: Array<{ content: unknown; options: unknown }> = [];
  messages: Array<{ role: string }> = [];
  aborts = 0;
  disposed = false;
  /** Tools registered through the session's extension API, as piChatSession's stub binding does. */
  readonly tools = new Map<string, ToolDefinition>();
  readonly extensionApi = { registerTool: (def: ToolDefinition) => void this.tools.set(def.name, def) } as unknown as ExtensionAPI;
  private listeners = new Set<(e: AgentSessionEvent) => void>();
  private runDone: (() => void) | null = null;
  private toolSeq = 0;

  constructor(readonly file: string) {}

  get pendingMessageCount(): number {
    return this.queue.length;
  }

  subscribe(listener: (e: AgentSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async prompt(text: string, options?: PromptOptions): Promise<void> {
    this.prompts.push(text);
    if (this.isStreaming) {
      this.steers.push(text);
      this.queue.push(text);
      options?.preflightResult?.("queued");
      return;
    }
    await new Promise((r) => setTimeout(r, 5));
    options?.preflightResult?.("started");
    this.isStreaming = true;
    const done = new Promise<void>((r) => (this.runDone = r));
    this.emit({ type: "agent_start" });
    this.emitUser(text);
    await done;
  }

  tool(name: string, args: Record<string, unknown>, ok = true): void {
    const toolCallId = `t${++this.toolSeq}`;
    this.emit({ type: "tool_execution_start", toolCallId, toolName: name, args });
    this.emit({ type: "tool_execution_end", toolCallId, toolName: name, result: "ok", isError: !ok });
  }

  /** Runs a real tool definition the way Pi would: start event, execute, end event, toolResult in the transcript. */
  async runTool(def: ToolDefinition, args: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
    const toolCallId = `t${++this.toolSeq}`;
    this.emit({ type: "tool_execution_start", toolCallId, toolName: def.name, args });
    let text: string;
    let isError = false;
    try {
      const r = await def.execute(toolCallId, args as never, signal, undefined, undefined as never);
      text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    } catch (err) {
      text = (err as Error).message;
      isError = true;
    }
    this.messages.push({ role: "toolResult", toolName: def.name, content: [{ type: "text", text }], isError } as { role: string });
    this.emit({ type: "tool_execution_end", toolCallId, toolName: def.name, result: text, isError });
  }

  toolStart(name: string, args: Record<string, unknown>): void {
    this.emit({ type: "tool_execution_start", toolCallId: `t${++this.toolSeq}`, toolName: name, args });
  }

  reply(text: string): void {
    for (const t of this.queue.splice(0)) this.emitUser(t);
    this.endMessage(text, "stop");
    this.settle();
  }

  clearQueue(): { steering: string[]; followUp: string[] } {
    const steering = this.queue;
    this.queue = [];
    return { steering, followUp: [] };
  }

  async abort(): Promise<void> {
    this.aborts++;
    if (!this.isStreaming) return;
    this.endMessage("", "aborted");
    this.settle();
  }

  async sendCustomMessage(message: { content: unknown }, options?: unknown): Promise<void> {
    this.customs.push({ content: message.content, options });
  }

  getContextUsage() {
    return { tokens: 1000, contextWindow: 10_000, percent: 10 };
  }

  dispose(): void {
    this.disposed = true;
  }

  private emit(e: unknown): void {
    for (const l of this.listeners) l(e as AgentSessionEvent);
  }

  private emitUser(text: string): void {
    this.emit({ type: "message_start", message: { role: "user", content: [{ type: "text", text }] } });
  }

  private endMessage(text: string, stopReason: string): void {
    this.messages.push({ role: "assistant" });
    this.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
        stopReason,
        usage: { input: 100, output: 20, cacheRead: 50, cacheWrite: 0, cost: { total: 0 } },
      },
    });
  }

  private settle(): void {
    const done = this.runDone;
    this.runDone = null;
    this.isStreaming = false;
    this.emit({ type: "agent_settled" });
    done?.();
  }
}

// ── Fake web surface ──────────────────────────────────────────────────────────
interface ProgressRecord {
  id: string;
  views: ProgressView[];
  final?: ProgressFinal;
}

interface ApprovalRecord {
  view: ApprovalView;
  nonce: string;
  decisions: ApprovalDecision[];
}

/** Records the structured views the link hands the surface. Shared across bot restarts, like a real chat. */
class FakeSurface implements SurfaceAdapter {
  readonly surface = SURFACE;
  readonly capabilities: SurfaceCapabilities = { streaming: false, tables: true, richButtons: true, reactions: true, maxMessageChars: 4000, fileUploads: true };
  acks: Array<{ messageId: string; kind: AckKind }> = [];
  notices: Array<{ messageId: string; notice: RouterNotice }> = [];
  replies: ReplyView[] = [];
  asks: AskView[] = [];
  auths: AuthPromptView[] = [];
  progress: ProgressRecord[] = [];
  approvals: ApprovalRecord[] = [];
  fallbacks: Array<{ text: string; offline: boolean }> = [];
  /** Everything posted to the chat, in order. */
  posted = 0;
  private seq = 0;

  acksOn(messageId: string): AckKind[] {
    return this.acks.filter((a) => a.messageId === messageId).map((a) => a.kind);
  }

  /** The latest view of a progress record. */
  current(p: ProgressRecord): ProgressView {
    return p.views.at(-1)!;
  }

  async ack(m: InboundMessage, kind: AckKind) {
    this.acks.push({ messageId: m.id, kind });
  }
  async notice(m: InboundMessage, notice: RouterNotice) {
    this.posted++;
    this.notices.push({ messageId: m.id, notice });
  }
  async transcribe() {
    return null;
  }
  async fallbackReply(_m: InboundMessage, text: string, opts: { offline: boolean }) {
    this.fallbacks.push({ text, offline: opts.offline });
    return `fallback answer to: ${text}`;
  }
  async resetFallback() {}
  async sendReply(_o: ChatOrigin | null, reply: ReplyView) {
    this.posted++;
    this.replies.push(reply);
  }
  async askPrompt(_o: ChatOrigin | null, ask: AskView) {
    this.posted++;
    this.asks.push(ask);
  }
  async authPrompt(_o: ChatOrigin | null, view: AuthPromptView) {
    this.posted++;
    this.auths.push(view);
  }
  progressEditGap() {
    return 0;
  }
  async progressCreate(_o: ChatOrigin | null, view: ProgressView): Promise<SurfaceMessageHandle> {
    this.posted++;
    const p = { id: `p${++this.seq}`, views: [structuredClone(view)] };
    this.progress.push(p);
    return { id: p.id };
  }
  async progressUpdate(handle: SurfaceMessageHandle, view: ProgressView) {
    this.byId(handle.id)?.views.push(structuredClone(view));
  }
  async progressFinalize(_o: ChatOrigin | null, handle: SurfaceMessageHandle | null, final: ProgressFinal) {
    const p = handle ? this.byId(handle.id) : undefined;
    if (p) p.final = final;
    else {
      this.posted++;
      this.progress.push({ id: `p${++this.seq}`, views: [], final });
    }
  }
  async progressReopen(_o: ChatOrigin | null, id: string): Promise<SurfaceMessageHandle | null> {
    return this.byId(id) ? { id } : null;
  }
  async approvalPrompt(_o: ChatOrigin | null, view: ApprovalView, nonce: string): Promise<SurfaceMessageHandle> {
    this.posted++;
    this.approvals.push({ view, nonce, decisions: [] });
    return { id: nonce };
  }
  async resolveApproval(_h: SurfaceMessageHandle, _v: ApprovalView, nonce: string, decision: ApprovalDecision) {
    this.approvals.find((a) => a.nonce === nonce)?.decisions.push(decision);
  }

  private byId(id: string | undefined): ProgressRecord | undefined {
    return this.progress.find((p) => p.id === id);
  }
}

const lineOf = (view: ProgressView, name: string) => view.lines.find((l) => l.name === name);

// ── Harness ───────────────────────────────────────────────────────────────────
const immediateTimers: Timers = {
  set: (fn) => setTimeout(fn, 0),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

async function waitFor(cond: () => boolean, what: string, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "ws-e2e-"));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

type Kill = "none" | "on-deliver" | "on-ack";

interface Bot {
  server: OrchestrationServer;
  link: WorkspaceLink;
  port: number;
  deliverRequests: number;
  kill: Kill;
  /** Every chat/message the bot sent the workspace. */
  messages: ChatMessageParams[];
  /** Inputs the bot's fake web_search ran with, and the tool/call audit lines. */
  searches: Array<Record<string, unknown>>;
  audits: ToolCallAudit[];
  tools: WorkspaceTools;
  /** Titles the bot's fake file_linear_issue (an approval-gated tool) filed. */
  filed: string[];
}

function fakeWebSearch(searches: Array<Record<string, unknown>>): ToolEntry<keyof ToolHosts> {
  return {
    name: "web_search",
    definition: { name: "web_search", description: "Search the web (fake).", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    requiresHosts: [],
    async execute(input) {
      searches.push(input);
      return { content: `3 results for ${String(input.query)}` };
    },
  };
}

function fakeLinear(filed: string[]): ToolEntry<keyof ToolHosts> {
  const str = { type: "string" };
  return {
    name: "file_linear_issue",
    definition: {
      name: "file_linear_issue",
      description: "File a Linear issue (fake).",
      parameters: { type: "object", properties: { title: str, description: str, repo_label: str }, required: ["title", "description", "repo_label"] },
    },
    requiresHosts: [],
    async execute(input) {
      filed.push(String(input.title));
      return { content: "Filed ENG-1" };
    },
  };
}

function startServer(port: number): OrchestrationServer {
  const server = new OrchestrationServer({ port, secretGrants: { [SECRET]: { principalId: P } } });
  return server;
}

const isOwner = (a: SurfaceActor) => a.surface === SURFACE && a.userId === OWNER;

async function startBot(store: WorkspaceLinkStore, surface: FakeSurface, port = 0, opts: { linear?: boolean } = {}): Promise<Bot> {
  const server = startServer(port);
  const surfaces = new SurfaceRegistry(SURFACE, { pinned: true }).register(surface);
  const searches: Array<Record<string, unknown>> = [];
  const audits: ToolCallAudit[] = [];
  const audit: AuditLog = { info: (obj) => void audits.push(obj) };
  const filed: string[] = [];
  const tools = new WorkspaceTools({
    principalId: P,
    ownerUserId: () => OWNER,
    toolSpace: { surface: "discord", spaceId: "dm" },
    surfaces,
    isOwner,
    store: {} as WorkspaceToolsOptions["store"],
    memory: { count: () => 0, getServerContext: () => null } as unknown as WorkspaceToolsOptions["memory"],
    registry: { resolve: () => [fakeWebSearch(searches), ...(opts.linear ? [fakeLinear(filed)] : [])] },
    log: audit,
  });
  const link = new WorkspaceLink({ principalId: P, store, surfaces, owner: () => ({ id: OWNER, name: "drk" }), isOwner, timers: immediateTimers, tools });
  const bot: Bot = { server, link, port: 0, deliverRequests: 0, kill: "none", messages: [], searches, audits, tools, filed };
  const die = () => setTimeout(() => server.stop(), 0);
  // Wraps the real server only to observe traffic and to simulate the bot process dying at a chosen point.
  const rpc: WorkspaceRpc = {
    getWorkspaceConnection: (p) => server.getWorkspaceConnection(p),
    requestWorkspace: (p, method, params, timeoutMs) => {
      if (method === RPC_METHODS.chatMessage) bot.messages.push(params as ChatMessageParams);
      if (method === RPC_METHODS.chatAck && bot.kill === "on-ack") {
        die();
        return new Promise(() => {});
      }
      return server.requestWorkspace(p, method, params, timeoutMs);
    },
    setWorkspaceHandler: (handler: WorkspaceHandler | null) => {
      if (!handler) return server.setWorkspaceHandler(null);
      server.setWorkspaceHandler({
        ...handler,
        onRequest: (conn, method, params) => {
          if (method === RPC_METHODS.chatDeliver) {
            bot.deliverRequests++;
            if (bot.kill === "on-deliver") {
              die();
              return new Promise(() => {});
            }
          }
          return handler.onRequest!(conn, method, params);
        },
      });
    },
  };
  link.attach(rpc);
  for (let attempt = 0; ; attempt++) {
    try {
      bot.port = server.listen().port!;
      break;
    } catch (err) {
      if (attempt > 50) throw err;
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  cleanups.push(() => server.stop());
  return bot;
}

interface Workspace {
  personal: PersonalSession;
  auth: AuthLogin;
  selector: BackendSelector;
  /** The Pi login the auth handlers run; tests replace it. */
  login: LoginFn;
  toolStubs: ToolStubs;
  /** Follows main's turns from its outgoing chat/events, as index.ts does for subagent progress. */
  turns: MainTurnTracker;
  sessions: FakePi[];
  stateDir: string;
  client: OrchestrationClient | null;
  /** The live fake Pi session. */
  pi(): FakePi;
  connect(url: string, secret?: string): OrchestrationClient;
  disconnect(): void;
  /** Outbox ids with no ack line. */
  unacked(): string[];
}

async function startWorkspace(): Promise<Workspace> {
  const stateDir = tempDir();
  const sessions: FakePi[] = [];
  const factory: ChatSessionFactory = async () => {
    const s = new FakePi(join(stateDir, `chat-${sessions.length + 1}.jsonl`));
    ws.toolStubs.binding().factory(s.extensionApi);
    sessions.push(s);
    return { session: s as unknown as ChatSession, sessionFile: s.file };
  };
  const ws: Workspace = {
    personal: null as unknown as PersonalSession,
    auth: null as unknown as AuthLogin,
    selector: new BackendSelector({ primaryEnabled: true }),
    login: async () => {
      throw new Error("no login configured");
    },
    toolStubs: new ToolStubs({
      principalId: P,
      request: (method, params, timeoutMs) => (ws.client ? ws.client.request(method, params, { timeoutMs }) : Promise.reject(new Error("not connected"))),
    }),
    turns: new MainTurnTracker(),
    sessions,
    stateDir,
    client: null,
    pi: () => sessions.at(-1)!,
    connect(url, secret = SECRET) {
      const client = new OrchestrationClient({
        url,
        runnerId: `workspace-${P}`,
        kind: "pi-workspace",
        secret,
        principalId: P,
        state: () => ws.personal.state,
        handlers: {
          ...ws.personal.handlers(),
          ...ws.auth.handlers(),
          ...commandHandlers({
            principalId: P,
            compact: async () => ({ error: "Nothing to compact (session too small)" }),
            choice: new ModelChoice({ provider: "chatgpt", chatgptModel: "gpt-6.1-sol", model: "openai/gpt-6-luna" } as WorkspaceConfig, stateDir),
            tasks: (arg) => (arg ? `project ${arg}: no open sub-tasks` : "**Quick**\n- Book dentist"),
          }),
        },
        onRegistered: (result) => {
          ws.toolStubs.update(result?.tools ?? []);
          ws.personal.onRegistered();
        },
        heartbeatMs: 0,
        backoffCapMs: 100,
      });
      ws.client = client;
      void client.run();
      cleanups.push(() => client.close());
      return client;
    },
    disconnect() {
      ws.client?.close();
      ws.client = null;
    },
    unacked() {
      const pending = new Set<string>();
      let raw = "";
      try {
        raw = readFileSync(join(stateDir, "outbox.jsonl"), "utf8");
      } catch {
        return [];
      }
      for (const line of raw.split("\n").filter(Boolean)) {
        const l = JSON.parse(line) as { type: string; entry?: { outboxId: string }; outboxId?: string };
        if (l.type === "entry") pending.add(l.entry!.outboxId);
        else pending.delete(l.outboxId!);
      }
      return [...pending];
    },
  };
  ws.personal = new PersonalSession({
    principalId: P,
    model: MODEL,
    stateDir,
    factory,
    textDeltaMs: null,
    transport: {
      request: (method, params) => (ws.client ? ws.client.request(method, params) : Promise.reject(new Error("not connected"))),
      notify: (method, params) => {
        ws.turns.observe(method, params);
        ws.client?.notify(method, params);
      },
      isConnected: () => ws.client?.connected ?? false,
    },
    resendIntervalMs: 200,
    now: () => NOW,
  });
  ws.auth = new AuthLogin({
    principalId: P,
    login: (interaction) => ws.login(interaction),
    deliver: (d) => ws.personal.deliverOutOfBand(d),
    model: "gpt-6.1-sol",
    onLoggedIn: () => ws.selector.reset(),
  });
  await ws.personal.start();
  cleanups.push(() => ws.personal.dispose());
  cleanups.push(() => ws.auth.cancel());
  return ws;
}

const ORIGIN: ChatOrigin = { surface: SURFACE, conversationId: "main" };
const ACTOR: SurfaceActor = { surface: SURFACE, userId: OWNER, name: "drk" };

/** The owner's chat message, routed as the web chat routes one. */
function router(link: () => WorkspaceLink, surface: FakeSurface) {
  const deps: OwnerRouterDeps<InboundMessage> = {
    workspaceEnabled: true,
    transcriptionEnabled: false,
    get link() {
      return link();
    },
    surface,
    cursor: { advance: () => {} },
  };
  const send = (id: string, text: string) =>
    handleOwnerMessage({ origin: ORIGIN, id, text, author: { id: OWNER, name: "drk" }, isVoice: false, attachments: [], actor: ACTOR }, deps);
  return { send };
}

async function linked(opts: { linear?: boolean } = {}) {
  const surface = new FakeSurface();
  const db = new Database(":memory:");
  applySchema(db);
  const store = new WorkspaceLinkStore(db);
  const bot = await startBot(store, surface, 0, opts);
  const ws = await startWorkspace();
  const r = { bot };
  const route = router(() => r.bot.link, surface);
  return { surface, store, r, ws, route, url: () => `ws://localhost:${r.bot.port}` };
}

async function connected(h: Awaited<ReturnType<typeof linked>>): Promise<void> {
  h.ws.connect(h.url());
  await waitFor(() => h.r.bot.link.isConnected() && h.ws.client!.connected, "workspace registered");
}

const NOW = new Date("2026-09-29T12:00:00Z");
/** The prompt text for a web message: its id isn't a snowflake, so it carries the receipt time. */
const stamped = (messageId: string, text: string) => `[web:${messageId} 2026-09-29 12:00 UTC]\n${text}`;

// ── Scenarios ─────────────────────────────────────────────────────────────────
describe("workspace e2e (bot ↔ transport ↔ workspace)", () => {
  test("1. a message is accepted, gets a live progress view, then the reply with usage and tool count; the outbox is acked", async () => {
    const h = await linked();
    await connected(h);

    await h.route.send("100", "what's in my home dir?");
    expect(h.surface.acksOn("100")).toEqual(["accepted"]);
    expect(h.ws.pi().prompts).toEqual([stamped("100", "what's in my home dir?")]);

    h.ws.pi().tool("bash", { command: "ls -la ~" });
    await waitFor(() => h.surface.progress.length === 1, "progress view");
    const progress = h.surface.progress[0]!;
    expect(lineOf(progress.views[0]!, "bash")).toMatchObject({ summary: "ls -la ~" });
    expect(progress.views[0]!.startedAt).toBeGreaterThan(0);

    h.ws.pi().tool("read", { path: "notes.md" });
    await waitFor(() => lineOf(h.surface.current(progress), "read") !== undefined, "progress update with the second tool");
    expect(lineOf(h.surface.current(progress), "bash")?.state).toBe("ok");

    h.ws.pi().reply("You have notes.md and a repos/ dir.");
    await waitFor(() => h.surface.replies.length === 1, "reply");
    const reply = h.surface.replies[0]!;
    expect(reply.text).toContain("You have notes.md and a repos/ dir.");
    expect(reply.toolCount).toBe(2);
    expect(reply.usage).toMatchObject({ model: MODEL });

    await waitFor(() => progress.final !== undefined, "progress finalized");
    expect(progress.final).toMatchObject({ outcome: "done", summary: { toolCount: 2 } });
    await waitFor(() => h.ws.unacked().length === 0, "outbox acked");
    expect(readFileSync(join(h.ws.stateDir, "outbox.jsonl"), "utf8")).toContain('"type":"ack"');
  });

  test("2. a second message mid-turn steers and the single reply answers it", async () => {
    const h = await linked();
    await connected(h);

    await h.route.send("200", "summarize the repo");
    h.ws.pi().tool("bash", { command: "git log -5" });
    await h.route.send("201", "also list open PRs");
    expect(h.surface.acksOn("201")).toEqual(["steer"]);
    expect(h.ws.pi().steers).toEqual([stamped("201", "also list open PRs")]);
    expect(h.ws.pi().prompts).toHaveLength(2);

    h.ws.pi().reply("Summary + PRs.");
    await waitFor(() => h.surface.replies.length === 1, "reply");
    await waitFor(() => h.ws.unacked().length === 0, "outbox acked");
    await new Promise((r) => setTimeout(r, 50));
    expect(h.surface.replies).toHaveLength(1);
    expect(h.r.bot.deliverRequests).toBe(1);
  });

  test("3. Stop with the current turnId aborts; a stale turnId (live next turn) does not", async () => {
    const h = await linked();
    await connected(h);

    await h.route.send("300", "first");
    h.ws.pi().tool("bash", { command: "echo 1" });
    await waitFor(() => h.surface.progress.length === 1, "turn 1 progress");
    const stale = h.surface.progress[0]!.views[0]!.turnId;
    h.ws.pi().reply("one");
    await waitFor(() => h.surface.replies.length === 1, "turn 1 reply");

    await h.route.send("301", "second, long running");
    h.ws.pi().toolStart("bash", { command: "sleep 600" });
    await waitFor(() => h.surface.progress.length === 2, "turn 2 progress");
    const progress2 = h.surface.progress[1]!;
    const current = progress2.views[0]!.turnId;
    expect(current).not.toBe(stale);

    expect(await h.r.bot.link.stopTurn(ORIGIN, stale, { ...ACTOR, userId: "someone" })).toEqual({ status: "forbidden" });
    expect(await h.r.bot.link.stopTurn(ORIGIN, stale, ACTOR)).toMatchObject({ status: "ok", aborted: false });
    expect(h.ws.pi().aborts).toBe(0);
    expect(h.ws.pi().isStreaming).toBe(true);

    expect(await h.r.bot.link.stopTurn(ORIGIN, current, ACTOR)).toMatchObject({ status: "ok", aborted: true });
    expect(h.ws.pi().aborts).toBe(1);
    await waitFor(() => progress2.final?.outcome === "stopped", "turn 2 progress shows stopped");

    await new Promise((r) => setTimeout(r, 50));
    expect(h.surface.replies).toHaveLength(1);
    expect(h.ws.unacked()).toEqual([]);
  });

  test("4. !new swaps the Pi session, records it in state.json, and later messages prompt the new session", async () => {
    const h = await linked();
    await connected(h);
    await h.route.send("400", "hello");
    h.ws.pi().reply("hi");
    await waitFor(() => h.surface.replies.length === 1, "first reply");
    const first = h.ws.pi();

    await h.route.send("401", "!new");
    expect(h.surface.acksOn("401")).toEqual(["newSession"]);
    expect(h.surface.notices.at(-1)).toEqual({ messageId: "401", notice: { type: "newSessionStarted" } });
    expect(h.ws.sessions).toHaveLength(2);
    expect(first.disposed).toBe(true);
    expect(readWorkspaceState(h.ws.stateDir)?.chatSessionFile).toBe(h.ws.pi().file);
    expect(h.r.bot.messages.map((m) => m.messageId)).not.toContain("401");

    await h.route.send("402", "fresh start");
    expect(h.ws.pi().prompts).toEqual([stamped("402", "fresh start")]);
    expect(first.prompts).toEqual([stamped("400", "hello")]);
  });

  test("5a. bot dies after sending the reply but before chat/ack: the restarted bot acks without resending", async () => {
    const h = await linked();
    await connected(h);
    await h.route.send("500", "do a thing");
    h.ws.pi().tool("bash", { command: "make" });
    await waitFor(() => h.surface.progress.length === 1, "progress");

    h.r.bot.kill = "on-ack";
    h.ws.pi().reply("done the thing");
    await waitFor(() => h.surface.replies.length === 1, "reply sent to the surface");
    await waitFor(() => !h.ws.client!.connected, "bot gone");
    expect(h.ws.unacked()).toHaveLength(1);

    h.r.bot = await startBot(h.store, h.surface, h.r.bot.port);
    await waitFor(() => h.r.bot.deliverRequests >= 1, "workspace resent the delivery", 5000);
    await waitFor(() => h.ws.unacked().length === 0, "outbox acked by the new bot");
    expect(h.surface.replies).toHaveLength(1);
  });

  test("5b. bot dies on receiving chat/deliver: the restarted bot delivers it exactly once", async () => {
    const h = await linked();
    await connected(h);
    await h.route.send("510", "do a thing");
    h.ws.pi().tool("bash", { command: "make" });
    await waitFor(() => h.surface.progress.length === 1, "progress");

    h.r.bot.kill = "on-deliver";
    h.ws.pi().reply("done the thing");
    await waitFor(() => !h.ws.client!.connected, "bot gone");
    expect(h.surface.replies).toHaveLength(0);
    expect(h.ws.unacked()).toHaveLength(1);

    h.r.bot = await startBot(h.store, h.surface, h.r.bot.port);
    await waitFor(() => h.ws.unacked().length === 0, "outbox acked by the new bot", 5000);
    // Let the periodic resend run at least once more: it must not produce a second message.
    await new Promise((r) => setTimeout(r, 400));
    expect(h.surface.replies).toHaveLength(1);
    expect(h.surface.replies[0]!.text).toContain("done the thing");
  });

  test("5c. bot dies mid-turn, the reply lands while it is down, and the restarted bot delivers it once", async () => {
    const h = await linked();
    await connected(h);
    await h.route.send("520", "long job");
    h.ws.pi().toolStart("bash", { command: "sleep 30" });
    await waitFor(() => h.surface.progress.length === 1, "progress");

    h.r.bot.server.stop();
    await waitFor(() => !h.ws.client!.connected, "bot gone");
    h.ws.pi().reply("job finished");
    expect(h.ws.unacked()).toHaveLength(1);

    h.r.bot = await startBot(h.store, h.surface, h.r.bot.port);
    await waitFor(() => h.ws.unacked().length === 0, "outbox acked by the new bot", 5000);
    await new Promise((r) => setTimeout(r, 400));
    expect(h.surface.replies).toHaveLength(1);
    expect(h.surface.replies[0]!.text).toContain("job finished");
  });

  test("6. workspace offline: fallback answer + inbox row; replayed as context on reconnect without a reply", async () => {
    const h = await linked();
    await connected(h);
    h.ws.disconnect();
    await waitFor(() => !h.r.bot.link.isConnected(), "workspace disconnected");

    await h.route.send("600", "are you there?");
    expect(h.surface.acksOn("600")).toEqual(["accepted"]);
    expect(h.surface.fallbacks).toEqual([{ text: "are you there?", offline: true }]);
    const rows = h.store.listInbox(P);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userText).toBe("are you there?");
    expect(rows[0]!.replyText).toBe("fallback answer to: are you there?");

    await connected(h);
    await waitFor(() => h.store.listInbox(P).length === 0, "inbox drained");
    const replayed = h.r.bot.messages.filter((m) => m.kind === "context");
    expect(replayed).toHaveLength(1);
    expect(replayed[0]!.messageId).toBe(`inbox:${rows[0]!.id}`);
    const pi = h.ws.pi();
    expect(pi.customs).toHaveLength(1);
    expect(String(pi.customs[0]!.content)).toContain("User: are you there?");
    expect(pi.customs[0]!.options).toEqual({ triggerTurn: false });
    expect(pi.prompts).toEqual([]);
    await new Promise((r) => setTimeout(r, 50));
    expect(h.r.bot.deliverRequests).toBe(0);
    expect(h.surface.replies).toHaveLength(0);
  });

  test("7. a wrong secret is rejected with 4401, and the message falls back", async () => {
    const h = await linked();
    const bad = new OrchestrationClient({ url: h.url(), runnerId: `workspace-${P}`, kind: "pi-workspace", secret: "wrong", principalId: P, heartbeatMs: 0 });
    cleanups.push(() => bad.close());
    const closed = new Promise<number>((resolve) => {
      const probe = new WebSocket(h.url());
      probe.addEventListener("open", () =>
        probe.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: RPC_METHODS.register, params: { runnerId: "probe", kind: "pi-workspace", role: "workspace", secret: "wrong" } })),
      );
      probe.addEventListener("close", (e) => resolve(e.code));
    });
    await expect(bad.connect()).rejects.toThrow("unauthorized");
    expect(await closed).toBe(ORCH_CLOSE.unauthorized);
    expect(h.r.bot.link.isConnected()).toBe(false);

    await h.route.send("700", "hello?");
    expect(h.surface.fallbacks).toEqual([{ text: "hello?", offline: true }]);
    expect(h.store.listInbox(P)).toHaveLength(1);
  });

  test("7b. a wrong-secret register does not evict the live workspace", async () => {
    const h = await linked();
    await connected(h);
    const bad = new OrchestrationClient({ url: h.url(), runnerId: `workspace-${P}`, kind: "pi-workspace", secret: "wrong", principalId: P, heartbeatMs: 0 });
    cleanups.push(() => bad.close());
    await expect(bad.connect()).rejects.toThrow("unauthorized");
    expect(h.r.bot.link.isConnected()).toBe(true);
    await h.route.send("710", "still there?");
    expect(h.surface.acksOn("710")).toEqual(["accepted"]);
    expect(h.surface.fallbacks).toEqual([]);
  });

  test("8. a duplicate messageId, sequential or concurrent, never prompts twice", async () => {
    const h = await linked();
    await connected(h);

    await Promise.all([h.route.send("800", "once please"), h.route.send("800", "once please")]);
    expect(h.ws.pi().prompts).toEqual([stamped("800", "once please")]);
    expect(h.surface.acksOn("800")).toEqual(["accepted"]);

    h.ws.pi().reply("once");
    await waitFor(() => h.surface.replies.length === 1, "reply");
    await h.route.send("800", "once please");
    expect(h.ws.pi().prompts).toEqual([stamped("800", "once please")]);
    expect(h.surface.acksOn("800")).toEqual(["accepted"]);
    const modes = h.r.bot.messages.filter((m) => m.messageId === "800");
    expect(modes).toHaveLength(3);
    await new Promise((r) => setTimeout(r, 50));
    expect(h.surface.replies).toHaveLength(1);
  });

  test("9. a bot tool round-trip: the manifest arrives at register, the stub calls the bot, the result lands in the transcript", async () => {
    const h = await linked();
    await connected(h);
    await waitFor(() => h.ws.toolStubs.names().length > 0, "tool manifest");
    expect(h.ws.toolStubs.names()).toEqual(["web_search"]);
    await waitFor(() => h.ws.pi().tools.has("web_search"), "stub registered in the live session");
    const search = h.ws.pi().tools.get("web_search")!;
    expect(search.parameters).toMatchObject({ required: ["query"], additionalProperties: false });

    await h.route.send("900", "search for bun releases");
    await h.ws.pi().runTool(search, { query: "bun releases" });
    expect(h.r.bot.searches).toEqual([{ query: "bun releases" }]);
    expect(h.r.bot.audits).toMatchObject([{ principalId: P, agentId: "main", agentName: "main", name: "web_search", ok: true, denied: false }]);
    expect(h.ws.pi().messages.at(-1)).toMatchObject({ role: "toolResult", toolName: "web_search", isError: false, content: [{ type: "text", text: "3 results for bun releases" }] });

    await waitFor(() => h.surface.progress.length === 1, "progress");
    await waitFor(() => lineOf(h.surface.current(h.surface.progress[0]!), "web_search") !== undefined, "web_search line");
    h.ws.pi().reply("Bun 2.0 is out.");
    await waitFor(() => h.surface.replies.length === 1, "reply");
    expect(h.surface.replies[0]!.text).toContain("Bun 2.0 is out.");
  });

  test("10. stopping a turn mid-approval withdraws the call: the prompt resolves cancelled and a later approve runs nothing", async () => {
    const h = await linked({ linear: true });
    await connected(h);
    await waitFor(() => h.ws.pi().tools.has("file_linear_issue"), "ask stub registered in the live session");

    await h.route.send("1000", "file a bug about login");
    const ac = new AbortController();
    const run = h.ws.pi().runTool(h.ws.pi().tools.get("file_linear_issue")!, { title: "Login crash", description: "D", repo_label: "sushii-bot" }, ac.signal);
    await waitFor(() => h.surface.approvals.length > 0, "approval prompt");
    const prompt = h.surface.approvals[0]!;
    expect(prompt.view.tool).toBe("file_linear_issue");

    ac.abort();
    await run;
    expect(h.ws.pi().messages.at(-1)).toMatchObject({ role: "toolResult", toolName: "file_linear_issue", isError: true });
    await waitFor(() => prompt.decisions.includes("cancelled"), "prompt resolved cancelled");
    expect(h.r.bot.tools.decide(prompt.nonce, "approve", ACTOR)).toBe("expired");
    expect(h.r.bot.filed).toEqual([]);
    h.ws.pi().reply("Stopped.");
  });
});

describe("workspace e2e: delegate, scheduled jobs, auto-mode asks", () => {
  test("11. a subagent's tool calls nest under the turn that delegated, and count toward its tools", async () => {
    const h = await linked();
    await connected(h);

    await h.route.send("1100", "research the outage");
    h.ws.pi().toolStart("delegate", { agent: "researcher", task: "find the outage cause" });
    await waitFor(() => h.surface.progress.length === 1, "progress view");
    const progress = h.surface.progress[0]!;
    const turn = h.ws.turns.current();
    expect(turn?.turnId).toBe(progress.views[0]!.turnId);

    // What SubagentHost.emit sends for the child's calls.
    const child = (ev: { type: "tool_start"; name: string; summary: string } | { type: "tool_end"; name: string; ok: boolean }) =>
      h.ws.client!.notify(RPC_METHODS.chatEvent, { principalId: P, turnId: turn!.turnId, agentId: "run-child-1", parentRunId: "run-main-1", ev });
    const childLine = () => h.surface.current(progress).lines.find((l) => l.agentId === "run-child-1");
    child({ type: "tool_start", name: "read", summary: "incident.md" });
    await waitFor(() => childLine() !== undefined, "nested child line");
    expect(childLine()).toMatchObject({ name: "read", summary: "incident.md", state: "run" });
    child({ type: "tool_end", name: "read", ok: true });
    await waitFor(() => childLine()?.state === "ok", "child line finished");

    h.ws.pi().reply("The cert expired.");
    await waitFor(() => h.surface.replies.length === 1, "reply");
    await waitFor(() => progress.final !== undefined, "progress finalized");
    expect(progress.final).toMatchObject({ outcome: "done", summary: { toolCount: 2 } });
  });

  test("12. a scheduled job's reply reaches the chat as a proactive message and lands in the session as context, with no turn", async () => {
    const h = await linked();
    await connected(h);
    const home = tempDir();
    const config = {
      principalId: P,
      home,
      stateDir: h.ws.stateDir,
      tz: "America/Los_Angeles",
      heartbeat: { when: { kind: "every", minutes: 120 } },
      proactiveDailyCap: 6,
    } as unknown as WorkspaceConfig;
    const scheduler = new Scheduler({ stateDir: h.ws.stateDir, at: "04:00", tz: config.tz });
    cleanups.push(() => scheduler.stop());
    const replies = ["Your passport renewal is due Friday.", "NO_REPLY"];
    // The deliver and note wiring is index.ts's; only the job's model run is faked.
    wireProactiveJobs(scheduler, {
      config,
      runs: new RunLog(h.ws.stateDir),
      selector: new BackendSelector({ primaryEnabled: false }),
      runner: async () => ({ text: replies.shift()! }) as Awaited<ReturnType<NonNullable<Parameters<typeof wireProactiveJobs>[1]["runner"]>>>,
      deliver: (text) => h.ws.personal.deliverOutOfBand({ kind: "proactive", text }),
      note: async (name, text) => {
        await h.ws.personal.handleMessage({
          origin: { surface: "workspace", conversationId: "schedule" },
          principalId: P,
          messageId: `job:${name}:1`,
          text,
          kind: "context",
          author: { id: "workspace", name: "scheduler" },
        });
      },
    });

    expect(await scheduler.runJob("heartbeat", { trigger: "manual", force: true })).toMatchObject({ status: "sent" });
    await waitFor(() => h.surface.replies.some((r) => r.text.includes("passport renewal")), "proactive message");
    expect(h.surface.replies.find((r) => r.text.includes("passport renewal"))!.kind).toBe("proactive");
    expect(h.ws.pi().prompts).toEqual([]);
    expect(JSON.stringify(h.ws.pi().customs)).toContain("You sent drk this proactive message: Your passport renewal is due Friday.");
    await waitFor(() => h.ws.unacked().length === 0, "proactive delivery acked");

    const before = h.surface.posted;
    expect(await scheduler.runJob("heartbeat", { trigger: "manual", force: true })).toMatchObject({ status: "no_reply" });
    expect(h.surface.posted).toBe(before);
  });

  test("13. an auto-mode ask mid-turn becomes a Yes/No ask; the owner's answer answers the dialog, not the agent", async () => {
    const h = await linked();
    await connected(h);

    await h.route.send("1300", "clean the build dir");
    // What the auto-mode extension does on an "ask" verdict, through the session's bound UI context.
    const allowed = h.ws.personal.ui.confirm("Auto mode: allow this tool call?", "bash: rm -rf build\n\nWhy it's asking: recursive delete");
    await waitFor(() => h.surface.asks.length > 0, "ask prompt");
    const ask = h.surface.asks[0]!;
    expect(JSON.stringify(ask)).toContain("rm -rf build");
    expect(ask.choices[0]).toBe("Yes");

    expect(await h.r.bot.link.answerAsk(ORIGIN, ask.askId!, { index: 0, label: "Yes" }, { ...ACTOR, userId: "someone" })).toEqual({ status: "forbidden" });
    expect(await h.r.bot.link.answerAsk(ORIGIN, ask.askId!, { index: 0, label: "Yes" }, ACTOR)).toMatchObject({ status: "answered", answer: "Yes" });

    expect(await allowed).toBe(true);
    expect(h.ws.pi().prompts).toEqual([stamped("1300", "clean the build dir")]);
    h.ws.pi().reply("Cleaned.");
    await waitFor(() => h.surface.replies.some((r) => r.text.includes("Cleaned.")), "reply");
  });
});

describe("workspace commands and asks outside a turn", () => {
  test("14. !tasks, !model and !compact go over chat/command and answer in the chat without reaching the agent", async () => {
    const h = await linked();
    await connected(h);
    const results = () => h.surface.notices.flatMap((n) => (n.notice.type === "commandResult" ? [n.notice.text] : []));
    await h.route.send("1400", "!tasks");
    await waitFor(() => results().some((t) => t.includes("Book dentist")), "tasks reply");
    await h.route.send("1401", "!tasks osaka");
    await waitFor(() => results().some((t) => t.includes("project osaka")), "project reply");
    await h.route.send("1402", "!model luna");
    await waitFor(() => results().some((t) => t.includes("Model set to **luna**")), "model reply");
    await h.route.send("1403", "!compact");
    await waitFor(() => results().some((t) => t.includes("Didn't compact")), "compact reply");
    expect(h.ws.pi().prompts).toEqual([]);
  });

  test("15. a workspace ask with no turn (the task review) reaches the preferred surface; an answer settles it", async () => {
    const h = await linked();
    await connected(h);
    const answer = h.ws.personal.askOwner("Stale: 1. Dentist", ["Keep all", "Drop all"], (t) => (/^(keep|drop) all$/i.test(t) ? { value: t.toLowerCase() } : null));
    await waitFor(() => h.surface.asks.some((a) => a.question.includes("Stale: 1. Dentist")), "review ask");
    const ask = h.surface.asks.find((a) => a.question.includes("Stale: 1. Dentist"))!;
    expect(ask.choices).toEqual(["Keep all", "Drop all"]);
    expect(await h.r.bot.link.answerAsk(ORIGIN, ask.askId!, { index: 1, label: "Drop all" }, ACTOR)).toMatchObject({ status: "answered" });
    expect(await answer).toBe("drop all");
    expect(h.ws.pi().prompts).toEqual([]);
  });
});

describe("ChatGPT login from the owner's chat", () => {
  test("!login chatgpt → sign-in link → pasted callback → connected; the paste never reaches the agent", async () => {
    const h = await linked();
    await connected(h);
    // A dead refresh token already sent the workspace onto OpenRouter.
    h.ws.selector.onChatGptFailure("OAuth refresh failed: invalid_grant");
    expect(h.ws.selector.select(true)).toBe("openrouter");
    const stored: string[] = [];
    h.ws.login = async (interaction) => {
      interaction.notify({ type: "auth_url", url: "https://auth.openai.com/api/accounts/authorize?state=st4te" });
      const input = await interaction.prompt({ type: "manual_code", message: "paste", signal: interaction.signal });
      const url = new URL(input);
      if (url.origin !== "http://127.0.0.1:1455" || url.searchParams.get("state") !== "st4te") throw new Error("OAuth state mismatch");
      stored.push(url.searchParams.get("code")!);
    };

    await h.route.send("100", "!login chatgpt");
    await waitFor(() => h.surface.auths.length > 0, "the sign-in prompt");
    const prompt = h.surface.auths[0]!;
    expect(prompt.url).toBe("https://auth.openai.com/api/accounts/authorize?state=st4te");
    expect(prompt.instructions).toContain("`!login cancel` to abort");
    expect(h.r.bot.link.isLoginPending()).toBe(true);

    await h.route.send("101", "http://localhost:1455/auth/callback?code=SECRET-CODE&state=st4te&client_id=c");
    await waitFor(() => h.surface.replies.some((r) => r.text.includes("ChatGPT connected")), "the result reply");
    expect(h.surface.replies.at(-1)!.text).toBe("✅ ChatGPT connected · gpt-6.1-sol");
    expect(stored).toEqual(["SECRET-CODE"]);

    expect(h.r.bot.messages).toEqual([]);
    expect(h.ws.pi().prompts.join("\n")).not.toContain("SECRET-CODE");
    expect(h.store.listInbox(P)).toEqual([]);
    expect(h.r.bot.link.isLoginPending()).toBe(false);
    expect(h.surface.acksOn("101")).toEqual(["accepted"]);
    expect(h.ws.selector.select(true)).toBe("chatgpt");
    await waitFor(() => h.ws.unacked().length === 0, "auth deliveries acked");

    // Afterwards an ordinary message goes to the agent again.
    await h.route.send("102", "hi");
    await waitFor(() => h.r.bot.messages.length === 1, "chat/message");
  });
});
