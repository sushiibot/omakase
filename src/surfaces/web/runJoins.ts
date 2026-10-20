import type { Database } from "bun:sqlite";
import { getLogger } from "../../logger.ts";
import { messageId } from "./chatSearch.ts";
import type { ApprovalDecision, ChatEventMap, MessageLocation, RunApprovalRecord, RunSummary, RunTrigger, UploadRef } from "./events.ts";

const log = getLogger("web/runJoins");

/** Run kinds whose tool calls the workspace sends as agent "main". */
const MAIN_SESSION_KINDS: ReadonlySet<RunSummary["kind"]> = new Set(["chat", "flush", "rotate"]);
export const RUN_APPROVALS_MAX = 100;
export const RUN_FILES_MAX = 100;

/** Matches `idx_web_events_turn` term for term, so the lookup uses it. */
export const RUN_FILES_SQL = `SELECT key, data, created_at FROM web_events WHERE type IN ('reply','proactive') AND json_extract(data, '$.turnId') = ? ORDER BY seq`;

type Row = { key: string | null; data: string; created_at: number };

/**
 * Approvals from the bot's log that belong to `run`. Approval rows carry no turnId, so a subagent's are
 * matched by its runId, a job's by its agent name, and Main's by time inside the run's window
 * [startedAt, endedAt). Only a running run's window ends now; a finished one without endedAt gets no window.
 */
export function runApprovals(db: Database, run: RunSummary, now: number): RunApprovalRecord[] {
  const start = Date.parse(run.startedAt);
  const end = run.endedAt !== undefined ? Date.parse(run.endedAt) : run.status === "running" ? now : NaN;
  const windowed = Number.isFinite(start) && Number.isFinite(end) && start < end;
  const windowAgent = MAIN_SESSION_KINDS.has(run.kind) ? "main" : run.kind === "job" ? run.agentName : null;
  const rows = db
    .query(
      `SELECT key, data, created_at FROM web_events WHERE type = 'approval' AND (
         json_extract(data, '$.view.agentId') = ?
         OR (? IS NOT NULL AND json_extract(data, '$.view.agentId') = ? AND created_at >= ? AND created_at < ?)
       ) ORDER BY seq LIMIT ?`,
    )
    .all(run.runId, windowed ? windowAgent : null, windowAgent, windowed ? start : 0, windowed ? end : 0, RUN_APPROVALS_MAX) as Row[];
  const approvals = rows.map((r) => ({ at: r.created_at, data: JSON.parse(r.data) as ChatEventMap["approval"] }));
  if (!approvals.length) return [];

  const nonces = approvals.flatMap((a) => [a.data.nonce, `${a.data.nonce}:result`]);
  const decisions = new Map<string, ApprovalDecision>();
  const resolved = db
    .query(`SELECT key, data, created_at FROM web_events WHERE type = 'approval_resolved' AND key IN (${nonces.map(() => "?").join(",")}) ORDER BY seq`)
    .all(...nonces) as Row[];
  for (const r of resolved) {
    const d = JSON.parse(r.data) as ChatEventMap["approval_resolved"];
    decisions.set(d.nonce, d.decision);
  }
  return approvals.map((a) => ({
    nonce: a.data.nonce,
    at: new Date(a.at).toISOString(),
    tool: a.data.view.tool,
    decision: decisions.get(a.data.nonce) ?? null,
  }));
}

/** Files the bot delivered on replies of the run's turn. A run without a turnId gets none. */
export function runFiles(db: Database, run: RunSummary): UploadRef[] {
  if (!run.turnId) return [];
  const rows = db
    .query(RUN_FILES_SQL)
    .all(run.turnId) as Row[];
  const out: UploadRef[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const f of (JSON.parse(r.data) as ChatEventMap["reply"]).files ?? []) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push(f);
      if (out.length >= RUN_FILES_MAX) return out;
    }
  }
  return out;
}

/** The last reply or proactive message the turn delivered, by `idx_web_events_turn`. */
const TURN_REPLY_SQL = `SELECT seq, key, conversation_id FROM web_events WHERE type IN ('reply','proactive') AND json_extract(data, '$.turnId') = ? ORDER BY seq DESC LIMIT 1`;
const TURN_ANCHOR_SQL = `SELECT anchor_seq AS a FROM web_turn_anchors WHERE turn_id = ?`;
/** A reply sorts at its turn's anchor, which outlives the anchors table's retention. */
const TURN_SORT_SQL = `SELECT sort_seq AS a FROM web_events WHERE type IN ('reply','proactive') AND json_extract(data, '$.turnId') = ? AND sort_seq IS NOT NULL LIMIT 1`;
/** The newest owner message or finished turn in a conversation at or before a position, by `idx_web_events_conversation_order`. */
const LAST_BEFORE_SQL = `SELECT seq, type, key, data FROM web_events WHERE conversation_id = ? AND type IN ('user','turn_final') AND coalesce(sort_seq, seq) <= ? ORDER BY coalesce(sort_seq, seq) DESC, seq DESC LIMIT 1`;
const LAST_USER_SQL = `SELECT seq, type, key, data FROM web_events WHERE conversation_id = ? AND type = 'user' AND coalesce(sort_seq, seq) <= ? AND coalesce(sort_seq, seq) > ? ORDER BY coalesce(sort_seq, seq) DESC, seq DESC LIMIT 1`;

type Located = { seq: number; type: string; key: string | null; data: string };

/** The chat head when the turn started. */
function turnAnchor(db: Database, turnId: string): number | null {
  const row = (db.query(TURN_ANCHOR_SQL).get(turnId) ?? db.query(TURN_SORT_SQL).get(turnId)) as { a: number | null } | null;
  return typeof row?.a === "number" ? row.a : null;
}

/** The owner message that started `turnId` in `conversationId`: the newest one before the turn started
 *  and after the previous turn started (a queued message counts), so a turn the agent began on its own
 *  has none. Null once the turn's start is unknown. */
function triggerMessage(db: Database, conversationId: string, turnId: string): MessageLocation | null {
  const anchor = turnAnchor(db, turnId);
  if (anchor === null) return null;
  // A turn's own final comes after its start, so the newest final before the start is the previous turn's.
  const last = db.query(LAST_BEFORE_SQL).get(conversationId, anchor) as Located | null;
  let floor = Number.MIN_SAFE_INTEGER;
  if (last?.type === "turn_final") {
    const prev = (JSON.parse(last.data) as Partial<ChatEventMap["turn_final"]>).turnId;
    floor = (typeof prev === "string" ? turnAnchor(db, prev) : null) ?? last.seq;
  }
  const user = db.query(LAST_USER_SQL).get(conversationId, anchor, floor) as Located | null;
  return user ? { conversationId, message: messageId(user) } : null;
}

/**
 * What the run produced and what started it, from the bot's chat log (web/docs/message-links.md):
 * the last reply its turn delivered, and the owner message that started the turn, the schedule, or the
 * run that delegated it.
 */
export function runLinks(db: Database, run: RunSummary): Pick<RunSummary, "result" | "trigger"> {
  let result: MessageLocation | undefined;
  let trigger: RunTrigger | undefined;
  if (run.turnId) {
    const reply = db.query(TURN_REPLY_SQL).get(run.turnId) as { seq: number; key: string | null; conversation_id: string } | null;
    if (reply) result = { conversationId: reply.conversation_id, message: messageId({ seq: reply.seq, type: "reply", key: reply.key }) };
  }
  if (run.parentRunId) trigger = { type: "parent", runId: run.parentRunId };
  else if (run.kind === "job" && run.jobName) trigger = { type: "schedule", jobName: run.jobName };
  else if (run.turnId && run.kind === "chat") {
    const message = triggerMessage(db, run.conversationId ?? result?.conversationId ?? "main", run.turnId);
    if (message) trigger = { type: "message", ...message };
  }
  return { ...(result ? { result } : {}), ...(trigger ? { trigger } : {}) };
}

/** `runs` with their result and trigger links. A failed join leaves a run as the workspace sent it. */
export function withRunLinks(db: Database, runs: readonly RunSummary[]): RunSummary[] {
  return runs.map((run) => {
    try {
      return { ...run, ...runLinks(db, run) };
    } catch (err) {
      log.warn({ err, runId: run.runId }, "run link join failed");
      return run;
    }
  });
}
