import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { SurfaceActor } from "../../orchestration/workspace/surface.ts";
import type { WorkspaceLink } from "../../orchestration/workspace/link.ts";
import { SqliteChatLog } from "./chatLog.ts";
import { WebInboundStore } from "./inbound.ts";
import { createPresence } from "./presence.ts";
import {
  createChatRoutes,
  type ChatRoutes,
  type ChatRouteDeps,
} from "./chatRoutes.ts";
import {
  WebWorkspaceAdapter,
  type WebAdapterDeps,
} from "./workspaceAdapter.ts";
import { historyPage } from "./history.ts";
import { json, readJson } from "./http.ts";
import type { PendingState } from "./events.ts";

interface ThreadRow {
  id: string;
  title: string;
  brief: string;
  created_at: number;
  archived_at: number | null;
  archived_by: "you" | "idle" | null;
  report: string | null;
  report_delivered: number;
}
export interface ThreadChannel {
  log: SqliteChatLog;
  adapter: WebWorkspaceAdapter;
  routes: ChatRoutes;
}
const branchBody = z
  .object({
    messageId: z.string().max(200),
    title: z.string().trim().min(1).max(120),
  })
  .strict();
const IDLE_DAYS = 7;

/** Additive navigator projection. Conversation IDs and their existing routes remain unchanged. */
export interface ChannelCatalogEntry {
  id: string;
  title: string;
  kind: "main" | "channel" | "task";
  taskId?: string;
  state: "archived" | "needs-you" | "running" | "idle";
  lastActivity: string | null;
  preview: string;
  pending: { asks: number; approvals: number; total: number };
  /** Canonical IDs and stored sequence positions for navigation to an exact request. */
  attention: { kind: "ask" | "approval"; id: string; seq: number; at: string }[];
  activity: { running: boolean; turnCount: number };
  headSeq: number;
  lastMessageSeq: number | null;
  /** Read receipts currently suppress push only; unknown is not the same as read. */
  unread: null;
  archived?: { at: string; by: "you" | "idle" | null };
}

const CATALOG_EVENTS = new Set([
  "user", "reply", "proactive", "ask", "ask_resolved", "approval",
  "approval_resolved", "turn_final",
]);

/** Bot-log projection, not a claim that a workspace ask is still live. Approval views match chat. */
export type ChannelPendingRequest = { state: "unresolved" } & (
  | { kind: "ask"; id: string; conversationId: string; createdAt: string; question: string; choices: string[]; toolConfirmation?: NonNullable<PendingState["asks"][number]["toolConfirmation"]> }
  | { kind: "approval"; id: string; conversationId: string; createdAt: string; view: PendingState["approvals"][number]["view"] });

/** Thread metadata and isolated web channels share the existing bot database. */
export class WebThreads {
  private mutation: Promise<unknown> = Promise.resolve();
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(fn, fn);
    this.mutation = next.catch(() => {});
    return next;
  }
  private readonly channels = new Map<string, ThreadChannel>();
  private readonly handles = new WeakMap<object, WebWorkspaceAdapter>();
  constructor(
    private readonly deps: {
      db: Database;
      main: ThreadChannel;
      link: Pick<WorkspaceLink, "topicManage" | "sendMessage">;
      chat: Omit<ChatRouteDeps, "log" | "inbound" | "adapter" | "presence">;
      adapter: Omit<WebAdapterDeps, "log" | "inbound" | "presence">;
    },
  ) {
    for (const row of this.rows())
      this.channel(row.id).log.cancelUnresolvedApprovals();
    let active = false;
    this.deps.main.log.subscribe(null, (ev) => {
      const running = this.deps.main.adapter.openTurns().length > 0;
      const changed = running !== active || CATALOG_EVENTS.has(ev.type);
      active = running;
      if (changed) this.changed("main");
    });
  }
  private changed(id: string) {
    this.deps.main.log.publish({ type: "threads", data: { id } });
  }
  private rows(): ThreadRow[] {
    return this.deps.db
      .query("SELECT * FROM web_threads ORDER BY created_at DESC")
      .all() as ThreadRow[];
  }
  private row(id: string): ThreadRow | null {
    return this.deps.db
      .query("SELECT * FROM web_threads WHERE id = ?")
      .get(id) as ThreadRow | null;
  }
  channel(id: string): ThreadChannel {
    if (id === "main") return this.deps.main;
    const known = this.channels.get(id);
    if (known) return known;
    if (!this.row(id)) throw new Error("unknown thread");
    const log = new SqliteChatLog(this.deps.db, { conversationId: id });
    const inbound = new WebInboundStore(this.deps.db, id);
    const presence = createPresence({ head: () => log.head() });
    const adapter = new WebWorkspaceAdapter({
      ...this.deps.adapter,
      log,
      inbound,
      presence,
    });
    const routes = createChatRoutes({
      ...this.deps.chat,
      log,
      inbound,
      presence,
      adapter,
      origin: { surface: "web", conversationId: id },
    });
    const c = { log, adapter, routes };
    this.channels.set(id, c);
    let active = false;
    log.subscribe(null, (ev) => {
      const running = adapter.openTurns().length > 0;
      if (
        running !== active ||
        CATALOG_EVENTS.has(ev.type)
      )
        this.changed(id);
      active = running;
    });
    return c;
  }
  /** One registered web surface dispatches origin-bearing calls and retains the channel in handles. */
  surface(): WebWorkspaceAdapter {
    const originMethods = new Set([
      "sendReply",
      "askPrompt",
      "askResolved",
      "authPrompt",
      "alertPrompt",
      "progressCreate",
      "turnStarted",
      "sessionChanged",
      "progressFinalize",
      "progressReopen",
      "approvalPrompt",
    ]);
    const handleMethods = new Set([
      "progressUpdate",
      "progressDelta",
      "resolveApproval",
    ]);
    const inboundMethods = new Set([
      "ack",
      "notice",
      "fallbackReply",
      "resetFallback",
    ]);
    return new Proxy(this.deps.main.adapter, {
      get: (target, key) => {
        const value = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          let adapter = target;
          if (originMethods.has(String(key))) {
            const origin = args[0] as {
              surface?: string;
              conversationId?: string;
            } | null;
            if (origin?.surface === "web" && origin.conversationId)
              adapter = this.channel(origin.conversationId).adapter;
          } else if (inboundMethods.has(String(key))) {
            const m = args[0] as { origin: { conversationId: string } };
            adapter = this.channel(m.origin.conversationId).adapter;
          } else if (handleMethods.has(String(key))) {
            adapter = this.handles.get(args[0] as object) ?? target;
          }
          const result = Reflect.apply(
            Reflect.get(adapter, key),
            adapter,
            args,
          );
          if (
            [
              "progressCreate",
              "turnStarted",
              "progressReopen",
              "approvalPrompt",
            ].includes(String(key))
          ) {
            return Promise.resolve(result).then((handle) => {
              if (
                handle &&
                typeof handle === "object" &&
                "id" in handle &&
                typeof handle.id === "string"
              )
                this.handles.set(handle, adapter);
              return handle;
            });
          }
          return result;
        };
      },
    });
  }
  /** Stable task conversation, shared by UI and assistant task controls. */
  async ensureTask(id: string, title: string, brief: string): Promise<void> {
    return this.exclusive(async () => {
      const existing = this.row(id);
      if (existing) { if (existing.archived_at) await this.resume(existing); return; }
      await this.deps.link.topicManage({ id, action: "create", title, brief });
      this.deps.db.run("INSERT INTO web_threads (id, title, brief, created_at) VALUES (?, ?, ?, ?)", [id, title, JSON.stringify({ known: [brief], open: [title], recentFromMain: 0 }), Date.now()]);
      this.channel(id).log.append("session", { kind: "new", initialContext: brief });
      this.changed(id);
    });
  }

  private summary(row: ThreadRow) {
    const c = this.channel(row.id);
    const latest = c.log.page(["user", "reply", "proactive"], { limit: 1 })[0];
    const pending = c.log.pending({
      approvalsSince: 0,
      asks: Number.MAX_SAFE_INTEGER,
    });
    return {
      id: row.id,
      title: row.title,
      state: row.archived_at
        ? "archived"
        : pending.asks.length || pending.approvals.length
          ? "needs-you"
          : c.adapter.openTurns().length
            ? "running"
            : "idle",
      lastActivity: new Date(latest?.createdAt ?? row.created_at).toISOString(),
      preview: latest
        ? (latest.data as { text: string }).text.slice(0, 200)
        : "No messages yet",
      writes: 0,
      memoryTracking: false,
      ...(row.archived_at
        ? {
            archived: {
              at: new Date(row.archived_at).toISOString(),
              by: row.archived_by,
            },
          }
        : {}),
    };
  }
  /** Complete pending state is independent of the capped transcript bootstrap. */
  private catalogEntry(id: string, row?: ThreadRow): ChannelCatalogEntry {
    const c = this.channel(id);
    const latest = c.log.page(["user", "reply", "proactive"], { limit: 1 })[0];
    const pending = c.log.pending({ approvalsSince: 0, asks: Number.MAX_SAFE_INTEGER });
    const asks = pending.asks.length;
    const approvals = pending.approvals.length;
    const turnCount = c.adapter.openTurns().length;
    const taskId = id.startsWith("task-t-") ? id.slice("task-".length) : undefined;
    return {
      id,
      title: row?.title ?? "Main",
      kind: id === "main" ? "main" : taskId ? "task" : "channel",
      ...(taskId ? { taskId } : {}),
      state: row?.archived_at ? "archived" : asks + approvals ? "needs-you" : turnCount ? "running" : "idle",
      lastActivity: latest || row ? new Date(latest?.createdAt ?? row!.created_at).toISOString() : null,
      preview: latest ? (latest.data as { text: string }).text.slice(0, 200) : id === "main" ? "Main conversation" : "No messages yet",
      pending: { asks, approvals, total: asks + approvals },
      attention: [
        ...pending.asks.map(ask => ({ kind: "ask" as const, id: ask.askId, seq: ask.seq, at: ask.at })),
        ...pending.approvals.map(approval => ({ kind: "approval" as const, id: approval.nonce, seq: approval.seq, at: approval.at })),
      ].sort((a, b) => a.seq - b.seq),
      activity: { running: turnCount > 0, turnCount },
      headSeq: c.log.head(),
      lastMessageSeq: latest?.seq ?? null,
      unread: null,
      ...(row?.archived_at ? { archived: { at: new Date(row.archived_at).toISOString(), by: row.archived_by } } : {}),
    };
  }

  catalog(): ChannelCatalogEntry[] {
    return [this.catalogEntry("main"), ...this.rows().map(row => this.catalogEntry(row.id, row))];
  }

  pendingRequests(): ChannelPendingRequest[] {
    return ["main", ...this.rows().map(row => row.id)].flatMap(conversationId => {
      const pending = this.channel(conversationId).log.pending({ approvalsSince: 0, asks: Number.MAX_SAFE_INTEGER });
      const requests: ChannelPendingRequest[] = [
        ...pending.asks.map(ask => ({ state: "unresolved" as const, kind: "ask" as const, id: ask.askId, conversationId, createdAt: ask.at, question: ask.question, choices: ask.choices, ...(ask.toolConfirmation ? { toolConfirmation: ask.toolConfirmation } : {}) })),
        ...pending.approvals.map(approval => ({ state: "unresolved" as const, kind: "approval" as const, id: approval.nonce, conversationId, createdAt: approval.at, view: approval.view })),
      ];
      return requests;
    }).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  private async close(row: ThreadRow, by: "you" | "idle") {
    if (row.archived_at) return this.summary(row);
    const channel = this.channel(row.id);
    await channel.routes.idle();
    const pending = channel.log.pending({ approvalsSince: 0, asks: 100 });
    if (pending.asks.length || pending.approvals.length)
      throw new Error(
        "Answer the thread's pending requests before archiving it.",
      );
    await this.deps.link.topicManage({ id: row.id, action: "close" });
    this.deps.db.run(
      "UPDATE web_threads SET archived_at = ?, archived_by = ?, report_delivered = 1 WHERE id = ?",
      [Date.now(), by, row.id],
    );
    this.changed(row.id);
    return this.summary(this.row(row.id)!);
  }
  private async resume(row: ThreadRow) {
    await this.deps.link.topicManage({ id: row.id, action: "reopen" });
    this.deps.db.run(
      "UPDATE web_threads SET archived_at = NULL, archived_by = NULL WHERE id = ?",
      [row.id],
    );
    this.changed(row.id);
  }
  async handle(
    req: Request,
    path: string,
    actor: SurfaceActor,
    server?: { timeout(req: Request, seconds: number): void },
  ): Promise<Response | null> {
    if (
      req.method === "POST" &&
      (path === "/api/threads" ||
        /^\/api\/threads\/[^/]+\/(close|reopen|rename|chat\/messages)$/.test(
          path,
        ))
    )
      return this.exclusive(() => this.handleRequest(req, path, actor, server));
    return this.handleRequest(req, path, actor, server);
  }
  private async handleRequest(
    req: Request,
    path: string,
    actor: SurfaceActor,
    server?: { timeout(req: Request, seconds: number): void },
  ): Promise<Response | null> {
    if (path === "/api/channels") {
      if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
      return json({ channels: this.catalog(), archiveAfterDays: IDLE_DAYS });
    }
    if (path === "/api/chats") {
      if (req.method !== "GET")
        return json({ error: "method not allowed" }, 405);
      const pending = this.deps.main.log.pending({
        approvalsSince: 0,
        asks: Number.MAX_SAFE_INTEGER,
      });
      const latest = this.deps.main.log.page(["user", "reply", "proactive"], {
        limit: 1,
      })[0];
      return json({
        main: {
          state:
            pending.asks.length || pending.approvals.length
              ? "needs-you"
              : this.deps.main.adapter.openTurns().length
                ? "running"
                : "idle",
          lastActivity: new Date(latest?.createdAt ?? Date.now()).toISOString(),
          preview: latest
            ? (latest.data as { text: string }).text.slice(0, 200)
            : "Main conversation",
        },
        threads: this.rows().filter(r => !r.id.startsWith("task-t-")).map((r) => this.summary(r)),
        archiveAfterDays: IDLE_DAYS,
      });
    }
    if (path === "/api/threads") {
      if (req.method !== "POST")
        return json({ error: "method not allowed" }, 405);
      const raw = await readJson(req, 16000);
      if (raw instanceof Response) return raw;
      const body = branchBody.safeParse(raw);
      if (!body.success) return json({ error: "invalid body" }, 400);
      const source = body.data.messageId
        ? (this.deps.db
            .query(
              "SELECT data FROM web_events WHERE conversation_id = 'main' AND (CAST(seq AS TEXT) = ? OR key = ?) AND type IN ('user', 'reply', 'proactive') ORDER BY seq DESC LIMIT 1",
            )
            .get(body.data.messageId, body.data.messageId) as {
            data: string;
          } | null)
        : null;
      const sourceText = source
        ? (JSON.parse(source.data) as { text: string }).text
        : "";
      if (body.data.messageId && !source)
        return json(
          { error: "The message is no longer in recent history." },
          404,
        );
      const brief = {
        known: source ? [sourceText.slice(0, 10000)] : [],
        open: [body.data.title],
        recentFromMain: 0,
      };
      const id = crypto.randomUUID();
      await this.deps.link.topicManage({
        id,
        action: "create",
        title: body.data.title,
        brief: JSON.stringify(brief),
      });
      this.deps.db.run(
        "INSERT INTO web_threads (id, title, brief, created_at) VALUES (?, ?, ?, ?)",
        [id, body.data.title, JSON.stringify(brief), Date.now()],
      );
      this.channel(id).log.append("session", { kind: "new", initialContext: `Topic: ${body.data.title}\nInitial context:\n${JSON.stringify(brief)}\nThis is an ongoing topic conversation. Continue its existing workstream across visits. Shared workspace files are available; other conversations have separate transcripts.` });
      this.changed(id);
      return json(this.summary(this.row(id)!), 201);
    }
    const match = /^\/api\/threads\/([A-Za-z0-9_-]{1,80})(?:\/(.*))?$/.exec(
      path,
    );
    if (!match) return null;
    const row = this.row(match[1]!);
    if (!row) return json({ error: "not found" }, 404);
    const sub = match[2];
    const c = this.channel(row.id);
    if (sub?.startsWith("chat/")) {
      if (row.archived_at && req.method === "POST" && sub === "chat/messages")
        await this.resume(row);
      return c.routes.handle(req, `/api/${sub}`, actor, server);
    }
    if (!sub && req.method === "GET")
      return json({
        summary: this.summary(row),
        brief: JSON.parse(row.brief),
        writes: [],
        history: historyPage(
          c.log,
          { limit: 40 },
          { maxBytes: 2 * 1024 * 1024 },
        ).items,
      });
    if (req.method !== "POST")
      return json({ error: "method not allowed" }, 405);
    if (sub === "rename") {
      const raw = await readJson(req, 16000);
      if (raw instanceof Response) return raw;
      const body = z
        .object({ title: z.string().trim().min(1).max(120) })
        .strict()
        .safeParse(raw);
      if (!body.success) return json({ error: "invalid body" }, 400);
      await this.deps.link.topicManage({
        id: row.id,
        action: "rename",
        title: body.data.title,
      });
      this.deps.db
        .query("UPDATE web_threads SET title = ? WHERE id = ?")
        .run(body.data.title, row.id);
      this.changed(row.id);
      return json(this.summary(this.row(row.id)!));
    }
    if (sub === "close") return json(await this.close(row, "you"));
    if (sub === "reopen") {
      await this.resume(row);
      return json(this.summary(this.row(row.id)!));
    }
    return json({ error: "not found" }, 404);
  }
  taskNeedsInput(id: string): boolean {
    if (!this.row(id)) return false;
    const pending = this.channel(id).log.pending({ approvalsSince: 0, asks: 100 });
    return pending.asks.length > 0 || pending.approvals.length > 0;
  }
  workspaceConnected() {
    for (const c of this.channels.values()) c.routes.workspaceConnected();
  }
  publish(ev: Parameters<SqliteChatLog["publish"]>[0]) {
    for (const c of this.channels.values()) c.log.publish(ev);
  }
  async prune() {
    for (const r of this.rows()) {
      const c = this.channel(r.id);
      c.log.prune(Date.now());
      if (
        !r.id.startsWith("task-t-") &&
        !r.archived_at &&
        this.summary(r).state === "idle" &&
        Date.parse(this.summary(r).lastActivity) <
          Date.now() - IDLE_DAYS * 86400000
      ) {
        try {
          await this.exclusive(async () => {
            const row = this.row(r.id)!;
            const summary = this.summary(row);
            if (
              summary.state === "idle" &&
              Date.parse(summary.lastActivity) <
                Date.now() - IDLE_DAYS * 86400000
            )
              await this.close(row, "idle");
          });
        } catch {
          /* Offline or still working: retry at the next prune. */
        }
      }
    }
  }
  async drain() {
    await Promise.all([...this.channels.values()].map((c) => c.routes.drain()));
  }
  closeStreams() {
    for (const c of this.channels.values()) {
      c.routes.closeStreams();
      c.adapter.close();
    }
  }
}
