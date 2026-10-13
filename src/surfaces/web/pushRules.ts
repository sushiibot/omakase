import type { JobAlert } from "./events.ts";
import type { PushPayload } from "./push.ts";

export const PUSH_BODY_MAX = 140;
const TITLE = "sushii-agent";

/** What the web adapter pushes for. Deltas, tools, status and notices never push. */
export type PushEvent =
  | { kind: "approval"; nonce: string; tool: string }
  | { kind: "ask"; askId: string; question: string }
  | { kind: "auth" }
  | { kind: "reply" | "proactive"; text: string }
  | { kind: "inbox"; key: string; text: string }
  | { kind: "alert"; alert: Pick<JobAlert, "job" | "error"> & { kind: "failed" | "stuck" } }
  /** Replaces the job's failure notification in the tray, silently. */
  | { kind: "alertRecovered"; job: string }
  | { kind: "interrupted" }
  /** A coding agent waits on the owner; one notification per provider request. */
  | { kind: "agentNeedsYou"; agentId: string; requestId: string; conversationId: string; label: string; description: string }
  /** Replaces that request's notification, silently, once it is answered or gone. */
  | { kind: "agentResolved"; agentId: string; requestId: string; conversationId: string; label: string }
  /** A coding agent ended or stalled and the owner's agent could not be woken to report it. */
  | { kind: "agentResult"; agentId: string; conversationId: string; label: string; status: "completed" | "failed" | "interrupted" | "stalled"; text: string }
  /** The owner's agent may not start or message coding agents in this conversation until the owner replies. */
  | { kind: "agentsPaused"; conversationId: string; cycles: number }
  | { kind: "quota"; usedBytes: number; capBytes: number };

// Approval, ask and alert links keep their older addresses, which the app redirects to the inbox: a service
// worker from before the inbox moved opens only those.
export function pushFor(event: PushEvent): PushPayload {
  switch (event.kind) {
    case "approval":
      return { title: "Approval needed", body: `sushii-agent needs your approval to run ${event.tool}`, url: `/?approve=${encodeURIComponent(event.nonce)}`, tag: `approval:${event.nonce}`, requireInteraction: true };
    case "ask":
      return event.askId
        ? { title: "The agent asks", body: plainPushBody(event.question), url: `/?ask=${encodeURIComponent(event.askId)}`, tag: `ask:${event.askId}` }
        : { title: "The agent asks", body: plainPushBody(event.question), url: "/chat", tag: "chat" };
    case "auth":
      return { title: TITLE, body: "Sign-in link ready", url: "/chat", tag: "auth" };
    case "reply":
      return { title: TITLE, body: plainPushBody(event.text) || "Sent a file", url: "/chat", tag: "chat", renotify: false };
    case "proactive":
      return { title: TITLE, body: plainPushBody(event.text) || "Sent a file", url: "/chat", tag: "chat" };
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
      return { title: TITLE, body: "Turn interrupted", url: "/chat", tag: "chat" };
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

// The conversation shows its agents above the composer; same addresses as the app's conversationHref.
const conversationUrl = (id: string) =>
  id === "main" ? "/chat" : id.startsWith("task-t-") ? `/tasks/${encodeURIComponent(id.slice(5))}?view=conversation` : `/chats/${encodeURIComponent(id)}`;
/** Opens the conversation with that agent's row expanded. */
const agentUrl = (conversationId: string, agentId: string) => {
  const url = conversationUrl(conversationId);
  return `${url}${url.includes("?") ? "&" : "?"}agent=${encodeURIComponent(agentId)}`;
};
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
