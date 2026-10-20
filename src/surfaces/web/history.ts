import type { HistoryPosition, SqliteChatLog, StoredEvent } from "./chatLog.ts";
import { CLIENT_ID_RE, type ApprovalDecision, type DurableEventType, type HistoryResponse, type UploadRef, type WebHistoryItem } from "./events.ts";
import type { WebUploadPort } from "./workspaceAdapter.ts";

/** Durable events that show in history. Resolutions fold into the item they resolve. */
const HISTORY_EVENTS = ["user", "reply", "proactive", "ask", "approval", "session", "alert"] as const satisfies readonly DurableEventType[];

type UploadLookup = Pick<WebUploadPort, "lookup">;

type Positioned = StoredEvent & { order: number };
type Rendered = { ev: Positioned; item: WebHistoryItem; size: number };
type RenderDeps = { uploads?: UploadLookup; maxBytes: number };

/** Ids a message link may carry (see web/docs/message-links.md), plus older turn ids. */
export const HISTORY_REF_RE = /^[0-9A-Za-z_:.-]{1,128}$/;
/** Items an around page returns on each side of its message, by default. */
export const AROUND_SIDE = 25;

/**
 * One page of the chat from the bot's own log: the newest `limit` items in history order below `before`,
 * oldest first, within `maxBytes`. `before` in the result is the page's oldest position, or null at the start.
 */
export function historyPage(log: SqliteChatLog, q: { before?: HistoryPosition; limit: number }, deps: RenderDeps): HistoryResponse {
  const rows = log.page(HISTORY_EVENTS, { ...(q.before !== undefined ? { before: q.before } : {}), limit: q.limit + 1 });
  const more = rows.length > q.limit;
  const rendered = render(log, rows.slice(0, q.limit), deps);
  const { kept, cut } = fit(rendered, deps.maxBytes);
  const oldest = kept.at(-1)?.ev;
  return { items: kept.map((r) => r.item).reverse(), before: (more || cut) && oldest ? cursorOf(oldest) : null };
}

/** The oldest `limit` items above `after`, oldest first. `after` in the result is the page's newest position,
 *  or null when it reaches the newest message. */
export function historyAfter(log: SqliteChatLog, q: { after: HistoryPosition; limit: number }, deps: RenderDeps): HistoryResponse {
  const rows = log.pageAfter(HISTORY_EVENTS, { after: q.after, limit: q.limit + 1 });
  const more = rows.length > q.limit;
  const { kept, cut } = fit(render(log, rows.slice(0, q.limit), deps), deps.maxBytes);
  const newest = kept.at(-1)?.ev;
  return { items: kept.map((r) => r.item), before: kept[0] ? cursorOf(kept[0].ev) : null, after: (more || cut) && newest ? cursorOf(newest) : null };
}

/**
 * The page around one message: its row with up to `side` items either way, oldest first. The id is resolved
 * by key over every type history shows, then as an ask id, then as `s<seq>`, then as a turn
 * id (that turn's latest reply). An id that resolves to nothing gives the page nearest its seq when it
 * carries one, else the newest page, with `missing`.
 */
export function historyAround(log: SqliteChatLog, q: { id: string; side: number }, deps: RenderDeps): HistoryResponse {
  const row = resolveRef(log, q.id);
  const seqRef = /^s(-?\d{1,15})$/.exec(q.id);
  if (!row && !seqRef) {
    const page = historyPage(log, { limit: q.side * 2 + 1 }, deps);
    return { ...page, after: null, target: null, missing: true };
  }
  const pivot: HistoryPosition = row ? { order: row.order, seq: row.seq } : { order: Number(seqRef![1]), seq: Number(seqRef![1]) };
  const olderRows = log.page(HISTORY_EVENTS, { before: pivot, limit: q.side + 1 });
  const newerRows = log.pageAfter(HISTORY_EVENTS, { after: pivot, limit: q.side + 1 });
  const all = render(log, [...olderRows.slice(0, q.side).reverse(), ...(row ? [row] : []), ...newerRows.slice(0, q.side)], deps);
  const olderCount = Math.min(olderRows.length, q.side);
  const older = all.slice(0, olderCount).reverse();
  const centre = row ? all[olderCount]! : null;
  const newer = all.slice(olderCount + (row ? 1 : 0));
  // The message itself always fits; then one item a side at a time, so neither side starves the other.
  let bytes = centre?.size ?? 0;
  let o = 0;
  let n = 0;
  let olderCut = false;
  let newerCut = false;
  while ((!olderCut && o < older.length) || (!newerCut && n < newer.length)) {
    if (!olderCut && o < older.length) {
      if ((centre || o || n) && bytes + older[o]!.size > deps.maxBytes) olderCut = true;
      else bytes += older[o++]!.size;
    }
    if (!newerCut && n < newer.length) {
      if ((centre || o || n) && bytes + newer[n]!.size > deps.maxBytes) newerCut = true;
      else bytes += newer[n++]!.size;
    }
  }
  const keptOlder = older.slice(0, o);
  const keptNewer = newer.slice(0, n);
  const oldest = keptOlder.at(-1)?.ev ?? centre?.ev ?? keptNewer[0]?.ev;
  const newest = keptNewer.at(-1)?.ev ?? centre?.ev ?? keptOlder[0]?.ev;
  const moreOlder = olderRows.length > q.side || olderCut;
  const moreNewer = newerRows.length > q.side || newerCut;
  return {
    items: [...keptOlder.reverse(), ...(centre ? [centre] : []), ...keptNewer].map((r) => r.item),
    before: moreOlder ? (oldest ? cursorOf(oldest) : formatCursor(pivot)) : null,
    after: moreNewer ? (newest ? cursorOf(newest) : formatCursor(pivot)) : null,
    target: centre ? centre.item.id : null,
    ...(row ? {} : { missing: true }),
  };
}


function resolveRef(log: SqliteChatLog, id: string): Positioned | null {
  // Every keyed row the history shows: owner messages by client id, agent rows by outbox key.
  for (const type of HISTORY_EVENTS) {
    const ev = log.find(type, id);
    const row = ev && log.positioned(ev.seq, HISTORY_EVENTS);
    if (row) return row;
  }
  const ask = log.findAsk(id);
  const asked = ask && log.positioned(ask.seq, HISTORY_EVENTS);
  if (asked) return asked;
  const seq = /^s(-?\d{1,15})$/.exec(id);
  const bySeq = seq && log.positioned(Number(seq[1]), HISTORY_EVENTS);
  if (bySeq) return bySeq;
  const reply = log.latestReplyOf(id);
  return reply === null ? null : log.positioned(reply, HISTORY_EVENTS);
}

const cursorOf = (ev: Positioned) => formatCursor({ order: ev.order, seq: ev.seq });

/** Keeps rendered rows in the given order while they fit, always the first. */
function fit(rows: Rendered[], maxBytes: number): { kept: Rendered[]; cut: boolean } {
  let bytes = 0;
  const kept: Rendered[] = [];
  for (const r of rows) {
    if (kept.length && bytes + r.size > maxBytes) return { kept, cut: true };
    kept.push(r);
    bytes += r.size;
  }
  return { kept, cut: false };
}

/** History items for stored rows, each within half the byte budget, with resolutions folded in. */
function render(log: SqliteChatLog, events: Positioned[], deps: RenderDeps): Rendered[] {
  const answers = new Map<string, string | null>();
  const askIds = events.flatMap((e) => (e.type === "ask" ? [(e as StoredEvent<"ask">).data.askId] : []));
  for (const r of log.list(["ask_resolved"], { keys: askIds }) as StoredEvent<"ask_resolved">[]) answers.set(r.data.askId, r.data.answer);
  const decisions = new Map<string, ApprovalDecision>();
  const nonces = events.flatMap((e) => (e.type === "approval" ? [(e as StoredEvent<"approval">).data.nonce] : []));
  const resolved = log.list(["approval_resolved"], { keys: nonces.flatMap((n) => [n, `${n}:result`]) }) as StoredEvent<"approval_resolved">[];
  for (const r of resolved) decisions.set(r.data.nonce, r.data.decision);
  const uploadIds = events.flatMap((e) => (e.type === "user" ? (e as StoredEvent<"user">).data.uploadIds : []));
  const known = deps.uploads && uploadIds.length ? deps.uploads.lookup([...new Set(uploadIds)]) : new Map<string, UploadRef>();

  const finals = new Map<string, StoredEvent<"turn_final">["data"]>();
  const turnIds = events.flatMap((e) => e.type === "reply" || e.type === "proactive" ? [(e as StoredEvent<"reply">).data.turnId].filter((id): id is string => !!id) : []);
  for (const final of log.list(["turn_final"], { keys: turnIds.flatMap((id) => [`${id}:done`, `${id}:stopped`, `${id}:interrupted`]) }) as StoredEvent<"turn_final">[]) finals.set(final.data.turnId, final.data);
  return events.map((ev) => {
    let item = toItem(ev, { answers, decisions, known, finals });
    let size = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (size > deps.maxBytes / 2 && item.type === "assistant" && item.tools.some((tool) => tool.diff || tool.input || tool.output)) {
      // Optional file patches must not replace an otherwise readable reply with a size error.
      item = { ...item, tools: item.tools.map((tool) => ({ ...tool, ...(tool.diff ? { diff: { patch: "", truncated: true } } : {}), ...(tool.input ? { input: "[Input omitted to fit history page]" } : {}), ...(tool.output ? { output: "[Output omitted to fit history page]" } : {}) })) };
      size = Buffer.byteLength(JSON.stringify(item)) + 1;
    }
    if (size > deps.maxBytes / 2) {
      item = tooLarge(item);
      size = Buffer.byteLength(JSON.stringify(item)) + 1;
    }
    return { ev, item, size };
  });
}

/** `<seq>` for a row in seq order, `<order>:<seq>` for one placed earlier. */
export function formatCursor(p: HistoryPosition): string {
  return p.order === p.seq ? String(p.seq) : `${p.order}:${p.seq}`;
}

export function parseCursor(raw: string): HistoryPosition | null {
  const m = /^(-?\d{1,15})(?::(-?\d{1,15}))?$/.exec(raw);
  if (!m) return null;
  const order = Number(m[1]);
  return { order, seq: m[2] === undefined ? order : Number(m[2]) };
}

function toItem(
  ev: StoredEvent,
  ctx: { answers: Map<string, string | null>; decisions: Map<string, ApprovalDecision>; known: Map<string, UploadRef>; finals: Map<string, StoredEvent<"turn_final">["data"]> },
): WebHistoryItem {
  const id = String(ev.seq);
  const at = new Date(ev.createdAt).toISOString();
  switch (ev.type) {
    case "user": {
      const d = (ev as StoredEvent<"user">).data;
      const attachments = d.uploadIds.map((uid) => {
        const file = ctx.known.get(uid) ?? null;
        return { name: file?.name ?? "file", contentType: file?.contentType ?? "application/octet-stream", file };
      });
      // An imported message's key isn't a clientId: it never had an outbox entry to settle.
      return { type: "user", id, ...(CLIENT_ID_RE.test(d.key) ? { clientId: d.key } : {}), at: d.at, text: d.text, attachments, ...(d.ref ? { ref: d.ref } : {}) };
    }
    case "reply":
    case "proactive": {
      const d = (ev as StoredEvent<"reply">).data;
      return {
        type: "assistant",
        id,
        at,
        text: d.text,
        outboxId: d.key,
        ...(d.turnId ? { turnId: d.turnId } : {}),
        ...(d.turnId && ctx.finals.get(d.turnId)?.activityText ? { activityText: ctx.finals.get(d.turnId)!.activityText } : {}),
        tools: (d.turnId ? ctx.finals.get(d.turnId)?.lines ?? [] : []).map(({ state, ...line }) => ({ ...line, ok: state === "ok" })),
        ...(d.usage ? { usage: d.usage } : {}),
        files: d.files,
      };
    }
    case "ask": {
      const d = (ev as StoredEvent<"ask">).data;
      const answer = ctx.answers.get(d.askId);
      return { type: "ask", id, at, outboxId: d.key, askId: d.askId, question: d.question, choices: d.choices, ...(d.toolConfirmation ? { toolConfirmation: d.toolConfirmation } : {}), ...(answer !== undefined ? { answer } : {}) };
    }
    case "approval": {
      const d = (ev as StoredEvent<"approval">).data;
      return { type: "approval", id: `approval:${d.nonce}`, at, nonce: d.nonce, view: d.view, decision: ctx.decisions.get(d.nonce) ?? null };
    }
    case "alert": {
      const d = (ev as StoredEvent<"alert">).data;
      return { type: "alert", id, at, outboxId: d.key, alert: d.alert, text: d.text };
    }
    default: {
      const d = (ev as StoredEvent<"session">).data;
      return { type: "divider", id, at, ...d };
    }
  }
}

function tooLarge(item: WebHistoryItem): WebHistoryItem {
  return { type: "assistant", id: item.id, at: item.at, text: "[This message is too large to show here.]", tools: [], files: [] };
}
