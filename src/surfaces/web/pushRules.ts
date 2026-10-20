import type { JobAlert } from "./events.ts";
import type { PushPayload } from "./push.ts";

export const PUSH_BODY_MAX = 140;
const TITLE = "sushii-agent";

/** What the web adapter pushes for. Deltas, tools, status and notices never push. */
export type PushEvent =
  | { kind: "approval"; nonce: string; tool: string }
  | { kind: "ask"; askId: string; question: string }
  | { kind: "auth" }
  /** `key` is the message's outbox id, which its link lands on. */
  | { kind: "reply" | "proactive"; text: string; key?: string }
  | { kind: "inbox"; key: string; text: string }
  | { kind: "alert"; alert: Pick<JobAlert, "job" | "error"> & { kind: "failed" | "stuck" } }
  /** Replaces the job's failure notification in the tray, silently. */
  | { kind: "alertRecovered"; job: string }
  /** `message` is the key of the turn's reply, when it has one. */
  | { kind: "interrupted"; message?: string }
  /** A coding agent waits on the owner; one notification per provider request. */
  | { kind: "agentNeedsYou"; agentId: string; requestId: string; conversationId: string; label: string; description: string }
  /** Replaces that request's notification, silently, once it is answered or gone. */
  | { kind: "agentResolved"; agentId: string; requestId: string; conversationId: string; label: string }
  /** A coding agent ended or stalled and the owner's agent could not be woken to report it. */
  | { kind: "agentResult"; agentId: string; conversationId: string; label: string; status: "completed" | "failed" | "interrupted" | "stalled"; text: string }
  /** The owner's agent may not start or message coding agents in this conversation until the owner replies. */
  | { kind: "agentsPaused"; conversationId: string; cycles: number }
  | { kind: "quota"; usedBytes: number; capBytes: number };

/** Conversation events link into `conversationId` (web/docs/message-links.md): a reply to its message, an ask
 *  or approval to its card. Alert, inbox and quota links keep their own screens. */
export function pushFor(event: PushEvent, conversationId = "main"): PushPayload {
  const chat = conversationUrl(conversationId);
  switch (event.kind) {
    case "approval":
      return { title: "Approval needed", body: `sushii-agent needs your approval to run ${event.tool}`, url: withParam(chat, "approve", event.nonce), tag: `approval:${event.nonce}`, requireInteraction: true };
    case "ask":
      return event.askId
        ? { title: "The agent asks", body: plainPushBody(event.question), url: withParam(chat, "ask", event.askId), tag: `ask:${event.askId}` }
        : { title: "The agent asks", body: plainPushBody(event.question), url: chat, tag: "chat" };
    case "auth":
      return { title: TITLE, body: "Sign-in link ready", url: chat, tag: "auth" };
    case "reply":
      return { title: TITLE, body: plainPushBody(event.text) || "Sent a file", url: messageUrl(conversationId, event.key), tag: "chat", renotify: false };
    case "proactive":
      return { title: TITLE, body: plainPushBody(event.text) || "Sent a file", url: messageUrl(conversationId, event.key), tag: "chat" };
    case "inbox":
      return { title: TITLE, body: plainPushBody(event.text), url: `/inbox?item=${encodeURIComponent(`msg:${event.key}`)}`, tag: `msg:${event.key}` };
    case "alert": {
      const { job, error } = event.alert;
      const body = error ? plainPushBody(`${job}: ${error}`) : job;
      // The job name already matched JOB_NAME_RE, so it needs no escaping in the URL.
      // renotify: a new streak's push replaces the last one's notification, and must still ring.
      return { title: event.alert.kind === "stuck" ? "Scheduled job stuck" : "Scheduled job failed", body, url: `/home?item=job:${job}`, tag: `job:${job}`, renotify: true };
    }
    case "alertRecovered":
      return { title: "Scheduled job working again", body: event.job, url: "/home", tag: `job:${event.job}`, silent: true };
    case "interrupted":
      return { title: TITLE, body: "Turn interrupted", url: messageUrl(conversationId, event.message), tag: "chat" };
    case "agentNeedsYou":
      return { title: `${event.label} needs approval`, body: literalPushBody(event.description), url: agentUrl(event.conversationId, event.agentId), tag: agentTag(event.agentId, event.requestId), requireInteraction: true };
    case "agentResolved":
      return { title: `${event.label}: approval answered`, body: "", url: agentUrl(event.conversationId, event.agentId), tag: agentTag(event.agentId, event.requestId), silent: true };
    case "agentResult": {
      const outcome = { completed: "finished", failed: "failed", interrupted: "was interrupted", stalled: "stalled" }[event.status];
      return { title: `${event.label} ${outcome}`, body: plainPushBody(event.text), url: agentUrl(event.conversationId, event.agentId), tag: `agent:${event.agentId}` };
    }
    case "agentsPaused":
      return { title: "Coding agents paused", body: `Your agent followed up ${event.cycles} times on its own. Reply in the conversation to let it continue.`, url: conversationUrl(event.conversationId), tag: `agents-paused:${event.conversationId}` };
    case "quota":
      return { title: "Photo storage almost full", body: `${Math.round((event.usedBytes / event.capBytes) * 100)}% of the photo quota is used.`, url: "/chat", tag: "quota" };
  }
}

// Same addresses as the app's conversationHref (web/src/lib/core/nav/conversation.ts), including
// the `m` message param from web/docs/message-links.md.
export const conversationUrl = (id: string, target: { message?: string; turn?: string } = {}) => {
  const path = id === "main" ? "/chat" : id.startsWith("task-t-") ? `/tasks/${encodeURIComponent(id.slice(5))}?view=conversation` : `/chats/${encodeURIComponent(id)}`;
  const params = [...(target.message ? [`m=${encodeURIComponent(target.message)}`] : []), ...(target.turn ? [`turn=${encodeURIComponent(target.turn)}`] : [])];
  return params.length ? `${path}${path.includes("?") ? "&" : "?"}${params.join("&")}` : path;
};
/** A message id a link may carry; the same as the app's MESSAGE_REF_RE. */
export const MESSAGE_REF_RE = /^(?:[0-9A-Za-z_-]{8,64}|s-?\d{1,15})$/;
/** The message's own link, or the conversation's when the key can't be one. */
const messageUrl = (conversationId: string, key: string | undefined) => conversationUrl(conversationId, key && MESSAGE_REF_RE.test(key) ? { message: key } : {});
const withParam = (url: string, key: string, value: string) => `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
/** Opens that agent from its conversation: in the side panel on desktop, as its own page on phones. */
const agentUrl = (conversationId: string, agentId: string) => withParam(conversationUrl(conversationId), "agent", agentId);
const agentTag = (agentId: string, requestId: string) => `agent:${agentId}:${requestId}`;

/** Text shown as written, such as a command to approve: whitespace collapsed and cut, never markdown-stripped. */
export function literalPushBody(text: string, max = PUSH_BODY_MAX): string {
  const points = Array.from(text.replace(/\s+/g, " ").trim());
  return points.length > max ? `${points.slice(0, max - 1).join("")}…` : points.join("");
}

/** Markdown reduced to the words a notification shade can show, cut to PUSH_BODY_MAX code points. */
export function plainPushBody(text: string, max = PUSH_BODY_MAX): string {
  const plain = text
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>+|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|\W)[*_](\S(?:.*?\S)?)[*_](?=\W|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  const points = Array.from(plain);
  return points.length > max ? `${points.slice(0, max - 1).join("")}…` : plain;
}
