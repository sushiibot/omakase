import { createConversationService, messageBody, stopBody, WEB_ORIGIN, type ConversationLink, type MessageRefs, type ConversationOperations, type SubmitOutcome, type StopOutcome } from "./application/conversationService.ts";
import type { UpdateSource } from "./updates.ts";
import { locationReply, type BrowserLocationRequests } from "../../orchestration/workspace/location.ts";
import { z } from "zod";
import { ID_MAX, type ChatOrigin } from "../../orchestration/contracts.ts";
import type { RouterNotice, SurfaceActor } from "../../orchestration/workspace/surface.ts";
import { APPROVAL_TIMEOUT_MS, NONCE_RE, type WorkspaceTools } from "../../orchestration/workspace/tools.ts";
import { getLogger } from "../../logger.ts";
import { type SqliteChatLog } from "./chatLog.ts";
import {
  CLIENT_ID_RE,
  HISTORY_LIMIT_MAX,
  MESSAGE_TEXT_MAX,
  type DiscardMessageResponse,
  type DiscardMessageRoutedResponse,
  type PostApprovalResponse,
  type PostAskResponse,
  type PostMessageResponse,
} from "./events.ts";
import { AROUND_SIDE, HISTORY_REF_RE, historyAfter, historyAround, historyPage, parseCursor as parseHistoryCursor } from "./history.ts";
import { forbidden, isJson, json, readJson } from "./http.ts";
import type { WebInboundStore } from "./inbound.ts";
import type { Presence } from "./presence.ts";
import { parseCursor, sseResponse, SSE_HEARTBEAT_MS, SSE_MAX_LIFETIME_MS } from "./sse.ts";
import type { WebUploadPort, WebWorkspaceAdapter } from "./workspaceAdapter.ts";

const log = getLogger("web/chatRoutes");

/** MESSAGE_TEXT_MAX chars can reach ~48 KB of UTF-8, plus the JSON around it. */

/** When the owner last wrote in this log, skipping messages the agent posted. */
export function lastOwnerMessageAt(log: Pick<SqliteChatLog, "page">): number | undefined {
  return log.page(["user"], { limit: 50 }).find((e) => !(e.data as { byAgent?: boolean }).byAgent)?.createdAt;
}
export const MESSAGE_BODY_MAX = 64 * 1024;
export const HISTORY_RESPONSE_MAX = 2 * 1024 * 1024;
const HISTORY_DEFAULT_LIMIT = 40;
export const PENDING_ASKS_MAX = 10;
const SHUTDOWN_IDLE_MS = 2_000;
/** How long a delete waits for a route already in flight to settle before calling the message delivered. */
const DISCARD_WAIT_MS = 20_000;

export { WEB_ORIGIN } from "./application/conversationService.ts";
export type ChatRouteLink = ConversationLink;

export interface ChatRouteDeps {
  log: SqliteChatLog;
  inbound: WebInboundStore;
  adapter: WebWorkspaceAdapter;
  presence: Presence;
  link: ChatRouteLink;
  tools: Pick<WorkspaceTools, "decide">;
  workspaceEnabled: boolean;
  uploads?: WebUploadPort;
  refs?: MessageRefs;
  location?: BrowserLocationRequests;
  origin?: ChatOrigin;
  now?: () => number;
  sse?: { heartbeatMs: number; maxLifetimeMs: number };
  historyMaxBytes?: number;
  discardWaitMs?: number;
}

export interface ChatRoutes {
  readonly conversation: ConversationOperations;
  setUpdates(source: UpdateSource): void;
  handle(req: Request, path: string, actor: SurfaceActor, server?: { timeout(req: Request, seconds: number): void }): Promise<Response | null>;
  closeStreams(): void;
  /** Resolves once every message being routed has finished; for tests and shutdown. */
  idle(): Promise<void>;
  /** idle(), bounded for shutdown. */
  drain(timeoutMs?: number): Promise<void>;
  /** The workspace link (re)connected: re-route messages that were stored but never routed. */
  workspaceConnected(): void;
}

const commandBody = z.object({ command: z.enum(["new", "compact"]) }).strict();
const askBody = z.union([
  z.object({ index: z.number().int().min(0).max(99), label: z.string().max(ID_MAX) }).strict(),
  z.object({ text: z.string().min(1).max(MESSAGE_TEXT_MAX) }).strict(),
]);
const approvalBody = z.object({ decision: z.enum(["approve", "deny"]) }).strict();
const seenBody = z.object({ seq: z.number().int().min(0) }).strict();

export function createChatRoutes(deps: ChatRouteDeps): ChatRoutes {
  let updates: UpdateSource | undefined;
  const { log: chatLog, inbound, adapter, presence, link, tools } = deps;
  const origin = deps.origin ?? WEB_ORIGIN;
  const now = deps.now ?? Date.now;
  const sseTimes = deps.sse ?? { heartbeatMs: SSE_HEARTBEAT_MS, maxLifetimeMs: SSE_MAX_LIFETIME_MS };
  const historyMax = deps.historyMaxBytes ?? HISTORY_RESPONSE_MAX;
  const shutdown = new AbortController();
  const conversation = createConversationService(deps);
  const notice = (n: RouterNotice) => void chatLog.append("notice", n);
  const online = () => deps.workspaceEnabled && link.isConnected();

  async function postMessage(req: Request, actor: SurfaceActor): Promise<Response> {
    const body = await parseBody(req, messageBody, MESSAGE_BODY_MAX);
    if (body instanceof Response) return body;
    return submitResponse(await conversation.submit(body, actor));
  }

  /** The owner tapped a queued message: route it now, mid-turn, steering the running turn. */
  async function postSteer(clientId: string, actor: SurfaceActor): Promise<Response> {
    if (!CLIENT_ID_RE.test(clientId)) return json({ error: "not found" }, 404);
    const row = inbound.get(clientId);
    if (!row) return json({ error: "not found" }, 404);
    if (row.state === "discarded") return json({ discarded: true } satisfies DiscardMessageResponse, 410);
    // Same retry semantics as a resend: a refused row goes back to pending, then routes.
    if (row.state === "rejected") inbound.markPending(clientId);
    if (row.state !== "routed") conversation.drive(row, actor);
    return json({ seq: row.seq, routed: row.state === "routed" } satisfies PostMessageResponse, 202);
  }

  /** The owner deleted a posted message: it must never reach the agent, unless it already did. */
  async function deleteMessage(clientId: string): Promise<Response> {
    if (!CLIENT_ID_RE.test(clientId)) return json({ error: "not found" }, 404);
    const inFlight = conversation.routingMessage(clientId);
    if (inFlight) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([inFlight, new Promise<void>((r) => (timer = setTimeout(r, deps.discardWaitMs ?? DISCARD_WAIT_MS)))]);
      clearTimeout(timer);
      // Still out with the workspace, which may already have it: it can't be called back.
      if (conversation.routingMessage(clientId)) return json({ routed: true } satisfies DiscardMessageRoutedResponse, 409);
    }
    const row = inbound.get(clientId);
    if (!row) {
      // Its POST may still be on the way; the tombstone makes that POST a 410 instead of a delivery.
      inbound.tombstone(clientId, now());
      return json({ error: "not found" }, 404);
    }
    if (inbound.discard(clientId)) return json({ discarded: true } satisfies DiscardMessageResponse);
    if (row.state === "discarded") return json({ discarded: true } satisfies DiscardMessageResponse);
    return json({ routed: true } satisfies DiscardMessageRoutedResponse, 409);
  }

  async function rewindMessage(req: Request, clientId: string, actor: SurfaceActor): Promise<Response> {
    if (!link.isOwner(actor)) return forbidden();
    if (!CLIENT_ID_RE.test(clientId)) return json({ error: "not found" }, 404);
    const body = await parseBody(req, z.object({ replacement: z.object({ clientId: z.string().regex(CLIENT_ID_RE), text: z.string().trim().min(1).max(MESSAGE_TEXT_MAX) }).strict().optional() }).strict(), MESSAGE_BODY_MAX);
    if (body instanceof Response) return body;
    if (body.replacement && (inbound.get(body.replacement.clientId) || inbound.claimedElsewhere(body.replacement.clientId))) return json({ error: "Replacement message already exists." }, 409);
    const target = chatLog.find("user", clientId);
    if (!target || target.data.byAgent) return json({ error: "Message not found." }, 404);
    if (!online() || !link.rewind) return json({ error: "Connect to the workspace before changing history." }, 503);
    if (conversation.rewinding || conversation.routingCount || adapter.openTurns().length || inbound.unrouted(0).length) return json({ error: "Wait for pending messages and running work to finish first." }, 409);
    conversation.rewinding = true;
    try {
      const result = await link.rewind(clientId, origin);
      if (!result.ok) return json({ error: result.error ?? "Could not rewind this conversation." }, 409);
      chatLog.transaction(() => {
        chatLog.rewindFrom(target.seq, clientId);
        if (body.replacement) {
          const { clientId: key, text } = body.replacement;
          const uploadIds = target.data.uploadIds;
          const at = now();
          const seq = chatLog.append("user", { key, text, uploadIds, at: new Date(at).toISOString() }, key);
          inbound.insert({ clientId: key, text, uploadIds, seq, createdAt: at });
        }
      });
      return json({ ok: true });
    } finally { conversation.rewinding = false; conversation.workspaceConnected(); }
  }

  async function postStop(req: Request, actor: SurfaceActor): Promise<Response> {
    const body = await parseBody(req, stopBody);
    if (body instanceof Response) return body;
    return stopResponse(await conversation.stop(body, actor));
  }

  async function postCommand(req: Request, actor: SurfaceActor): Promise<Response> {
    const body = await parseBody(req, commandBody);
    if (body instanceof Response) return body;
    if (!link.isOwner(actor)) return forbidden();
    void (async () => {
      if (!deps.workspaceEnabled) return notice({ type: "workspaceOffline" });
      if (body.command === "new") {
        if (!link.isConnected()) return notice({ type: "newWhileOffline" });
        try {
          await link.newSession(origin);
          notice({ type: "newSessionStarted" });
        } catch (err) {
          notice({ type: "newSessionFailed", error: errorText(err) });
        }
        return;
      }
      if (!link.isConnected()) return notice({ type: "commandOffline" });
      try {
        const res = await link.command("compact", undefined, origin);
        notice({ type: "commandResult", text: res.text });
      } catch (err) {
        notice({ type: "commandFailed", error: errorText(err) });
      }
    })().catch((err) => log.error({ err }, "web command failed"));
    return new Response(null, { status: 202 });
  }

  async function postAsk(req: Request, askId: string, actor: SurfaceActor): Promise<Response> {
    const body = await parseBody(req, askBody);
    if (body instanceof Response) return body;
    // The adapter keeps askIds unique, so this is the card the owner answered; its own stored choices
    // decide the answer, never the link's in-memory list, which a later ask can overwrite.
    const ask = chatLog.findAsk(askId);
    if (!ask) return json({ error: "unknown ask" }, 404);
    const text = "text" in body ? body.text : ask.data.choices[body.index];
    if (text === undefined) return json({ status: "inactive" } satisfies PostAskResponse);
    const res = await link.answerAsk(origin, askId, { text }, actor);
    if (res.status === "forbidden") return forbidden();
    if (res.status === "answered" || res.status === "duplicate") chatLog.append("ask_resolved", { askId, answer: res.answer }, askId);
    // The workspace no longer waits on it, so it must not come back as answerable on the next open.
    else if (res.status === "inactive") chatLog.append("ask_resolved", { askId, answer: null }, askId);
    return json({ status: res.status } satisfies PostAskResponse);
  }

  async function postApproval(req: Request, nonce: string, actor: SurfaceActor): Promise<Response> {
    const body = await parseBody(req, approvalBody);
    if (body instanceof Response) return body;
    // Only a nonce the bot itself posted here can be decided from this route.
    if (!NONCE_RE.test(nonce) || !chatLog.find("approval", nonce)) return json({ error: "unknown approval" }, 404);
    const res = tools.decide(nonce, body.decision, actor);
    if (res === "forbidden") return forbidden();
    return json({ status: res } satisfies PostApprovalResponse);
  }

  async function postSeen(req: Request): Promise<Response> {
    const body = await parseBody(req, seenBody);
    if (body instanceof Response) return body;
    presence.seen(body.seq);
    return new Response(null, { status: 204 });
  }

  function getHistory(req: Request): Response {
    const params = new URL(req.url).searchParams;
    const rawBefore = params.get("before");
    const rawAfter = params.get("after");
    const around = params.get("around");
    const rawLimit = params.get("limit");
    if ([rawBefore, rawAfter, around].filter((p) => p !== null).length > 1) return json({ error: "use one of before, after and around" }, 400);
    // An around page takes `limit` as its total: the message and half of the rest on each side.
    const limit = rawLimit === null ? (around === null ? HISTORY_DEFAULT_LIMIT : AROUND_SIDE * 2) : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_LIMIT_MAX) return json({ error: "invalid limit" }, 400);
    const render = { maxBytes: historyMax, ...(deps.uploads ? { uploads: deps.uploads } : {}) };
    let page;
    if (around !== null) {
      if (!HISTORY_REF_RE.test(around)) return json({ error: "invalid message id" }, 400);
      page = historyAround(chatLog, { id: around, side: Math.max(1, Math.floor(limit / 2)) }, render);
    } else if (rawAfter !== null) {
      const after = parseHistoryCursor(rawAfter);
      if (after === null) return json({ error: "invalid cursor" }, 400);
      page = historyAfter(chatLog, { after, limit }, render);
    } else {
      // Imported rows have seqs at or below zero.
      const before = rawBefore === null ? undefined : parseHistoryCursor(rawBefore);
      if (before === null) return json({ error: "invalid cursor" }, 400);
      page = historyPage(chatLog, { limit, ...(before ? { before } : {}) }, render);
    }
    return new Response(JSON.stringify(page), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }

  function getStream(req: Request, server?: { timeout(req: Request, seconds: number): void }): Response {
    // A cross-site page can't read the stream, but a same-origin check keeps it from opening one at all.
    if (req.headers.get("Sec-Fetch-Site") !== "same-origin") return forbidden();
    const after = parseCursor(req);
    if (after === undefined) return json({ error: "invalid cursor" }, 400);
    if (shutdown.signal.aborted) return json({ error: "shutting down" }, 503);
    server?.timeout(req, 0);
    const streamId = crypto.randomUUID();
    return sseResponse(chatLog, after, {
      ...sseTimes,
      updates,
      onOpen: () => presence.open(streamId),
      hello: () => ({
        workspace: online() ? "online" : "offline",
        openTurns: adapter.openTurns(),
        pending: chatLog.pending({ approvalsSince: now() - APPROVAL_TIMEOUT_MS, asks: PENDING_ASKS_MAX }),
      }),
      signal: AbortSignal.any([req.signal, shutdown.signal]),
    });
  }

  return {
    conversation,
    setUpdates(source) { updates = source; },
    async handle(req, path, actor, server) {
      if (!path.startsWith("/api/chat/")) return null;
      if (conversation.rewinding && req.method !== "GET") return json({ error: "History is being changed. Try again." }, 409);
      conversation.observeActor(actor);
      const method = req.method;
      const sub = path.slice("/api/chat/".length);
      if (sub === "stream") return method === "GET" ? getStream(req, server) : methodNotAllowed();
      if (sub === "history") return method === "GET" ? getHistory(req) : methodNotAllowed();
      const message = /^messages\/([^/]+)$/.exec(sub);
      if (message) return method === "DELETE" ? deleteMessage(decodeSegment(message[1]!) ?? "") : methodNotAllowed();
      const rewind = /^messages\/([^/]+)\/rewind$/.exec(sub);
      if (rewind) return method === "POST" ? rewindMessage(req, decodeSegment(rewind[1]!) ?? "", actor) : methodNotAllowed();
      const steer = /^messages\/([^/]+)\/steer$/.exec(sub);
      if (steer) return method === "POST" ? postSteer(decodeSegment(steer[1]!) ?? "", actor) : methodNotAllowed();
      if (method !== "POST") return methodNotAllowed();
      if (sub === "messages") return postMessage(req, actor);
      if (sub === "stop") return postStop(req, actor);
      if (sub === "command") return postCommand(req, actor);
      if (sub === "seen") return postSeen(req);
      const ask = /^asks\/([^/]+)$/.exec(sub);
      if (ask) {
        const askId = decodeSegment(ask[1]!);
        return askId ? postAsk(req, askId, actor) : json({ error: "not found" }, 404);
      }
      const location = /^location\/([A-Za-z0-9_-]{16})$/.exec(sub);
      if (location && deps.location) {
        if (!link.isOwner(actor)) return forbidden();
        const body = await parseBody(req, locationReply, 1024);
        if (body instanceof Response) return body;
        const status = deps.location.fulfill(location[1]!, body, actor);
        if (status === "forbidden") return forbidden();
        if (status === "invalid") return json({ error: "invalid location result" }, 400);
        return json({ status });
      }
      const approval = /^approvals\/([^/]+)$/.exec(sub);
      if (approval) return postApproval(req, approval[1]!, actor);
      return json({ error: "not found" }, 404);
    },
    closeStreams() {
      shutdown.abort();
      conversation.close();
    },
    async idle() {
      await conversation.idle();
    },
    workspaceConnected() {
      conversation.workspaceConnected();
    },
    async drain(timeoutMs = SHUTDOWN_IDLE_MS) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([this.idle(), new Promise<void>((r) => (timer = setTimeout(r, timeoutMs)))]);
      clearTimeout(timer);
    },
  };
}

async function parseBody<T extends z.ZodTypeAny>(req: Request, schema: T, limit?: number): Promise<z.infer<T> | Response> {
  if (!isJson(req)) return json({ error: "content-type must be application/json" }, 415);
  const raw = await readJson(req, limit);
  if (raw instanceof Response) return raw;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return json({ error: "invalid body" }, 400);
  return parsed.data;
}

function decodeSegment(s: string): string | null {
  try {
    const out = decodeURIComponent(s);
    return out && out.length <= ID_MAX ? out : null;
  } catch {
    return null;
  }
}

function methodNotAllowed(): Response {
  return json({ error: "method not allowed" }, 405);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function submitResponse(result: SubmitOutcome): Response {
  switch (result.kind) {
    case "accepted": return json({ seq: result.seq, routed: result.routed }, 202);
    case "invalid": return json({ error: result.error }, 400);
    case "conflict": return json({ error: result.error }, 409);
    case "discarded": return json({ discarded: true }, 410);
    case "upload-missing": return json({ error: "upload_missing", ids: result.ids }, 409);
  }
}
function stopResponse(result: StopOutcome): Response {
  switch (result.kind) {
    case "accepted": return new Response(null, { status: 202 });
    case "forbidden": return forbidden();
    case "invalid": return json({ error: result.error }, 400);
    case "conflict": return json({ error: result.error }, 409);
  }
}
