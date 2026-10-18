import { z } from "zod";
import { ID_MAX, WEB_CONVERSATION_ID, uploadUrl, type ChatMessageParams, type ChatOrigin } from "../../../orchestration/contracts.ts";
import type { WorkspaceLink } from "../../../orchestration/workspace/link.ts";
import { handleOwnerMessage, type OwnerRouterDeps } from "../../../orchestration/workspace/router.ts";
import type { InboundMessage, RouterNotice, SurfaceActor } from "../../../orchestration/workspace/surface.ts";
import { getLogger } from "../../../logger.ts";
import { INBOUND_RETENTION_MS, type SqliteChatLog } from "../chatLog.ts";
import { CLIENT_ID_RE, MESSAGE_TEXT_MAX, MESSAGE_UPLOADS_MAX, UPLOAD_ID_RE, type UploadRef } from "../events.ts";
import type { InboundRow, WebInboundStore } from "../inbound.ts";
import type { WebUploadPort, WebWorkspaceAdapter } from "../workspaceAdapter.ts";
const log = getLogger("web/conversationService");
export const WEB_ORIGIN: ChatOrigin = Object.freeze({ surface: "web", conversationId: WEB_CONVERSATION_ID });
export type ConversationLink = Pick<
  WorkspaceLink,
  | "isConnected"
  | "sendMessage"
  | "abort"
  | "newSession"
  | "recordOffline"
  | "interceptReply"
  | "isOwner"
  | "isLoginPending"
  | "startLogin"
  | "completeLogin"
  | "cancelLogin"
  | "command"
  | "stopTurn"
  | "answerAsk"
> & Partial<Pick<WorkspaceLink, "rewind">>;

export interface ConversationDeps {
  log: SqliteChatLog;
  inbound: WebInboundStore;
  adapter: WebWorkspaceAdapter;
  link: ConversationLink;
  workspaceEnabled: boolean;
  uploads?: WebUploadPort;
  origin?: ChatOrigin;
  now?: () => number;
}
export type SubmitMessage = { clientId: string; text: string; voice?: boolean; uploadIds?: string[] };
export type StopConversation = { turnId?: string };
export type SubmitOutcome =
  | { kind: "accepted"; seq: number; routed: boolean }
  | { kind: "invalid" | "conflict"; error: string }
  | { kind: "discarded" }
  | { kind: "upload-missing"; ids: string[] };
export type StopOutcome = { kind: "accepted" } | { kind: "forbidden" } | { kind: "invalid" | "conflict"; error: string };
export interface ConversationOperations {
  submit(body: SubmitMessage, actor: SurfaceActor, origin?: "owner" | "agent"): Promise<SubmitOutcome>;
  stop(body: StopConversation, actor: SurfaceActor): Promise<StopOutcome>;
}
export const messageBody = z
  .object({
    clientId: z.string().regex(CLIENT_ID_RE),
    text: z.string().max(MESSAGE_TEXT_MAX),
    voice: z.boolean().optional(),
    uploadIds: z.array(z.string().regex(UPLOAD_ID_RE)).max(MESSAGE_UPLOADS_MAX).optional(),
  })
  .strict()
  .refine((b) => b.text.trim() !== "" || (b.uploadIds?.length ?? 0) > 0, "empty message");
export const stopBody = z.object({ turnId: z.string().min(1).max(ID_MAX).optional() }).strict();
/** Owns durable acceptance, routing, queued redelivery and the rewind exclusion gate for one conversation. */
export function createConversationService(deps: ConversationDeps) {
  const { log: chatLog, inbound, adapter, link } = deps;
  const origin = deps.origin ?? WEB_ORIGIN;
  const now = deps.now ?? Date.now;
  let closed = false;
  // clientIds being routed right now, so a duplicate POST can't route the same message twice at once.
  const routing = new Map<string, Promise<void>>();
  let rewinding = false;

  const online = () => deps.workspaceEnabled && link.isConnected();
  // Routing needs a verified actor from a caller; a re-drive waits for one.
  let lastActor: SurfaceActor | undefined;
  let redriveWanted = false;
  let redriving = false;
  const notice = (n: RouterNotice) => void chatLog.append("notice", n);

  // The last open turn just ended: that is when rows queued behind it are routed, in seq order.
  adapter.onTurnsIdle = () => redriveUnrouted();

  /** Routes a persisted message through the owner router. A receipt (or a consuming notice) marks it
   *  routed; a workspaceOffline notice leaves it for the client to resend. */
  function drive(row: { clientId: string; text: string; uploadIds: string[]; voice?: boolean }, actor: SurfaceActor): void {
    // Checked in the same tick routing starts, so a delete either sees this route in flight or wins outright.
    if (rewinding || routing.has(row.clientId) || inbound.get(row.clientId)?.state !== "pending") return;
    const run = (async () => {
      const known = row.uploadIds.length && deps.uploads ? deps.uploads.lookup(row.uploadIds) : new Map<string, UploadRef>();
      const attachments: InboundMessage["attachments"] = row.uploadIds.flatMap((id) => {
        const ref = known.get(id);
        return ref ? [{ url: uploadUrl(id), name: ref.name, contentType: ref.contentType }] : [];
      });
      const message: InboundMessage = {
        origin,
        id: row.clientId,
        text: row.text,
        author: { id: actor.userId, name: actor.name },
        isVoice: false,
        attachments,
        actor,
      };
      const routerLink: OwnerRouterDeps<InboundMessage>["link"] = {
        isConnected: () => link.isConnected(),
        sendMessage: async (input: Omit<ChatMessageParams, "principalId">) => {
          const res = await link.sendMessage({ ...input, ...(row.voice ? { voice: true } : {}) });
          // The workspace already has it (say, a resend after a bot restart): that is still a receipt.
          if (res.mode === "duplicate" && input.messageId === row.clientId) await adapter.ack(message, "accepted");
          return res;
        },
        abort: (turnId?: string) => link.abort(turnId, origin),
        newSession: () => link.newSession(origin),
        recordOffline: (u, r, o) => link.recordOffline(u, r, o),
        interceptReply: (m) => link.interceptReply(m),
        isOwner: (a) => link.isOwner(a),
        isLoginPending: () => link.isLoginPending(),
        startLogin: (o) => link.startLogin(o),
        completeLogin: (i) => link.completeLogin(i),
        cancelLogin: () => link.cancelLogin(),
        command: (c, a) => link.command(c, a, origin),
      };
      await handleOwnerMessage(message, {
        workspaceEnabled: deps.workspaceEnabled,
        transcriptionEnabled: false,
        link: routerLink,
        surface: adapter,
        cursor: { advance: () => {} },
        offline: "reject",
      });
    })()
      .catch((err) => log.error({ err, clientId: row.clientId }, "routing a web message failed"))
      .finally(() => routing.delete(row.clientId));
    routing.set(row.clientId, run);
  }

  /** Routes every stored, never-routed message in the order it was sent. The workspace dedupes by clientId,
   *  so one it already took answers as a duplicate and is marked routed. Gated on no open turn: a row
   *  queued behind a running turn waits for its end (the adapter calls back then), never re-routes mid-turn. */
  function redriveUnrouted(): void {
    redriveWanted = true;
    const actor = lastActor;
    if (rewinding || redriving || !actor || !online() || adapter.openTurns().length > 0 || closed) return;
    redriving = true;
    redriveWanted = false;
    void (async () => {
      for (const row of inbound.unrouted(now() - INBOUND_RETENTION_MS)) {
        if (!online() || closed) break;
        // A turn started while this pass ran: the rest stay pending, in order, for its end.
        if (adapter.openTurns().length > 0) {
          redriveWanted = true;
          break;
        }
        drive(row, actor);
        await routing.get(row.clientId);
      }
    })()
      .catch((err) => log.error({ err }, "re-routing stored web messages failed"))
      .finally(() => {
        redriving = false;
        // A reconnect while this pass ran may have left new pending rows behind it.
        if (redriveWanted) redriveUnrouted();
      });
  }

  /** A message sent while a turn runs is held by the bot, not the device: it is acked `queued`, which
   *  leaves the row pending, and routed when the turn ends (or the owner steers it). True when held. */
  function queueBehindTurn(row: { clientId: string; text: string }, actor: SurfaceActor): boolean {
    // Already out with the workspace: its receipt settles it, so it is not queued behind the turn.
    if (routing.has(row.clientId)) return true;
    if (!online() || adapter.openTurns().length === 0) return false;
    const message: InboundMessage = {
      origin,
      id: row.clientId,
      text: row.text,
      author: { id: actor.userId, name: actor.name },
      isVoice: false,
      attachments: [],
      actor,
    };
    adapter.ack(message, "queued").catch((err) => log.error({ err, clientId: row.clientId }, "acking a queued web message failed"));
    return true;
  }

  async function submit(input: SubmitMessage, actor: SurfaceActor, source: "owner" | "agent" = "owner"): Promise<SubmitOutcome> {
    if (rewinding) return { kind: "conflict", error: "History is being changed. Try again." };
    observeActor(actor);
    const parsed = messageBody.safeParse(input);
    if (!parsed.success) return { kind: "invalid", error: "invalid body" };
    const body = parsed.data;
    if (inbound.claimedElsewhere(body.clientId)) return { kind: "conflict", error: "This message id belongs to another conversation." };
    const uploadIds = [...new Set(body.uploadIds ?? [])];
    const existing = inbound.get(body.clientId);
    if (existing) {
      if (existing.text !== body.text) log.warn({ clientId: body.clientId }, "a resent web message differs from the stored one; keeping the stored one");
      if (existing.state === "discarded") return { kind: "discarded" };
      // A resend of a refused message is the owner's retry: it goes back to pending and is routed again.
      if (existing.state === "rejected") inbound.markPending(existing.clientId);
      if (existing.state !== "routed" && !queueBehindTurn(existing, actor)) drive(existing, actor);
      return { kind: "accepted", seq: existing.seq, routed: existing.state === "routed" };
    }
    if (uploadIds.length && !deps.uploads) return { kind: "invalid", error: "uploads are not available" };
    const at = now();
    let row: InboundRow;
    try {
      row = chatLog.transaction(() => {
        // A concurrent duplicate may have been stored while this request's body was read.
        const raced = inbound.get(body.clientId);
        if (raced) return raced;
        // In the same transaction as the insert, so a message held for days never loses its photos to orphan GC.
        const missing = uploadIds.length ? deps.uploads!.markReferenced(uploadIds, body.clientId).missing : [];
        if (missing.length) throw new UploadMissing(missing);
        const seq = chatLog.append("user", { key: body.clientId, text: body.text, uploadIds, at: new Date(at).toISOString(), ...(source === "agent" ? { byAgent: true as const } : {}) }, body.clientId);
        const stored = { clientId: body.clientId, text: body.text, uploadIds, seq, createdAt: at, ...(body.voice ? { voice: true } : {}) };
        inbound.insert(stored);
        return { ...stored, routedAt: null, state: "pending" as const };
      });
    } catch (err) {
      if (err instanceof UploadMissing) return { kind: "upload-missing", ids: err.ids };
      throw err;
    }
    if (row.state === "discarded") return { kind: "discarded" };
    if (row.state !== "routed" && !queueBehindTurn(row, actor)) drive(row, actor);
    return { kind: "accepted", seq: row.seq, routed: row.state === "routed" };
  }

  async function stop(input: StopConversation, actor: SurfaceActor): Promise<StopOutcome> {
    if (rewinding) return { kind: "conflict", error: "History is being changed. Try again." };
    observeActor(actor);
    const parsed = stopBody.safeParse(input);
    if (!parsed.success) return { kind: "invalid", error: "invalid body" };
    const body = parsed.data;
    if (!link.isOwner(actor)) return { kind: "forbidden" };
    void (async () => {
      if (!online()) return notice({ type: "nothingToStop" });
      if (body.turnId) {
        const res = await link.stopTurn(origin, body.turnId, actor);
        if (res.status === "failed") notice({ type: "stopFailed", error: res.error });
        else if (res.status === "ok" && res.final) await adapter.progressFinalize(origin, { id: body.turnId }, res.final);
        return;
      }
      try {
        if (!(await link.abort(undefined, origin)).aborted) notice({ type: "nothingToStop" });
      } catch (err) {
        notice({ type: "stopFailed", error: errorText(err) });
      }
    })().catch((err) => log.error({ err }, "web stop failed"));
    return { kind: "accepted" };
  }


  function observeActor(actor: SurfaceActor) {
    lastActor = actor;
    if (redriveWanted) redriveUnrouted();
  }
  return {
    submit, stop, observeActor, drive,
    get rewinding() { return rewinding; },
    set rewinding(value: boolean) { rewinding = value; },
    routingMessage(id: string) { return routing.get(id); },
    get routingCount() { return routing.size; },
    workspaceConnected: redriveUnrouted,
    close() { closed = true; },
    async idle() { while (routing.size) await Promise.all([...routing.values()]); },
  };
}
class UploadMissing extends Error {
  constructor(readonly ids: string[]) {
    super("upload missing");
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
