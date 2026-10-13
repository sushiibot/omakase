import {
  sessionRecord,
  type AgentResultParams,
  type SessionRecord,
  type SessionSummary,
} from "./contracts.ts";
import type { ActionOrigin, MachineControl, SessionObserver } from "./control.ts";
import { agentFolder, agentKeys, type CodingAgentRecord } from "./agents.ts";
import type { WorkspaceLink } from "../workspace/link.ts";
import type { JsonState } from "../../db/jsonState.ts";
import type { PushEvent } from "../../surfaces/web/pushRules.ts";
import { getLogger } from "../../logger.ts";

const log = getLogger("agent-events");
type Reported = AgentResultParams["status"];
type Result = Omit<AgentResultParams, "principalId">;
const TERMINAL = new Set<string>(["completed", "failed", "interrupted"]);
/** Wake → agent action cycles a conversation may run without the owner before its agent is paused. */
export const MAX_AUTO_CYCLES = 3;
const TAIL_MAX = 2000;

interface Acted {
  v: number;
  /** Provider request ids the owner was notified about and not yet told were answered. */
  pushed: string[];
  /** The stall episode (its stalledAt) already reported, so one stall wakes the agent once. */
  stall?: string;
}
/** Per conversation. A cycle is a wake followed by the agent starting or messaging a coding agent. */
interface Loop {
  cycles: number;
  /** When the count last reset: an owner message or an owner action in the app. */
  since: number;
  wokeAt?: number;
  countedWake?: number;
  /** The owner was told about this pause already. */
  notified?: boolean;
}
/** A result waiting for a workspace that can take it. */
interface Pending {
  result: Result;
  attempts: number;
  nextAt: number;
}
const OUTBOX_RETRY_MAX_MS = 60 * 60_000;
export interface AgentEventDeps {
  control: Pick<MachineControl, "hub" | "agents" | "list">;
  link: Pick<WorkspaceLink, "agentResult" | "isConnected">;
  state: JsonState;
  push(event: PushEvent): Promise<unknown>;
  lastOwnerMessageAt(conversationId: string): number | undefined;
  now?(): number;
  /** How long a result waits for a reconnecting workspace before the owner is pushed as well. */
  workspaceWaitMs?: number;
  /** How often undelivered results are retried; 0 leaves it to flushOutbox calls. */
  outboxRetryMs?: number;
}

const loopKey = (conversationId: string) => `agent-loop:${conversationId}`;
const isRecord = (v: SessionSummary | SessionRecord): v is SessionRecord => "id" in v;

/** "Codex agent on Desktop", plus "in Code/web" for a subfolder: how the owner and the agent name a coding agent. */
export function agentLabel(provider: CodingAgentRecord["provider"], machineName: string, folder?: string) {
  return `${provider === "codex" ? "Codex" : "Claude Code"} agent on ${machineName}${folder ? ` in ${folder}` : ""}`;
}
const labelOf = (agent: CodingAgentRecord, machineName: string) =>
  agentLabel(agent.provider, machineName, agent.path ? agentFolder(agent) : undefined);

/**
 * Level-triggered: every trigger (live event, connect snapshot, a read of the agent) compares the session's
 * stateVersion with the last one acted on, so a duplicate or missed event never acts twice or not at all.
 */
export class AgentEvents implements SessionObserver {
  private queues = new Map<string, Promise<void>>();
  private timer?: ReturnType<typeof setInterval>;
  constructor(private deps: AgentEventDeps) {
    const retry = deps.outboxRetryMs ?? 15_000;
    if (retry > 0) {
      this.timer = setInterval(() => void this.flushOutbox(), retry);
      this.timer.unref?.();
    }
  }

  close() {
    clearInterval(this.timer);
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  readonly onSession = (machineId: string, summary: SessionSummary) => {
    void this.reconcile(machineId, summary).catch((err) =>
      log.warn({ err, agentId: summary.sessionId }, "reconciling a coding agent failed; the next event or read retries"),
    );
  };

  observe(machineId: string, record: SessionRecord): void {
    if (record.stateVersion === undefined) return;
    void this.reconcile(machineId, record).catch((err) =>
      log.warn({ err, agentId: record.id }, "reconciling a coding agent failed; the next event or read retries"),
    );
  }

  /** Serialized per agent, so a notification, a snapshot and a read never act on the same version twice. */
  reconcile(machineId: string, input: SessionSummary | SessionRecord): Promise<void> {
    const id = isRecord(input) ? input.id : input.sessionId;
    const previous = this.queues.get(id) ?? Promise.resolve();
    const next = previous.then(() => this.run(machineId, input));
    const settled = next.catch(() => {});
    this.queues.set(id, settled);
    void settled.then(() => {
      if (this.queues.get(id) === settled) this.queues.delete(id);
    });
    return next;
  }

  /** The conversation's cycle count, reset by an owner message there since the last reset. */
  private loop(conversationId: string): Loop {
    const loop = this.deps.state.get<Loop>(loopKey(conversationId)) ?? { cycles: 0, since: 0 };
    const owner = this.deps.lastOwnerMessageAt(conversationId);
    return owner !== undefined && owner > loop.since ? { cycles: 0, since: owner } : loop;
  }

  /** Refuses an agent-initiated start or message once the conversation ran its automatic cycles. */
  guard(conversationId: string): void {
    const loop = this.loop(conversationId);
    if (loop.cycles < MAX_AUTO_CYCLES) return;
    if (!loop.notified) {
      this.deps.state.set(loopKey(conversationId), { ...loop, notified: true } satisfies Loop);
      void this.push({ kind: "agentsPaused", conversationId, cycles: loop.cycles });
    }
    throw new Error(
      `Coding agents in this conversation are paused after ${loop.cycles} automatic follow-ups. Tell the owner what happened and wait for their reply before starting or messaging an agent again.`,
    );
  }

  noteAction(conversationId: string, origin: ActionOrigin): void {
    if (origin === "owner") {
      this.deps.state.set(loopKey(conversationId), { cycles: 0, since: this.now() } satisfies Loop);
      return;
    }
    const loop = this.loop(conversationId);
    // Only the first action after a wake the owner has not answered makes a cycle.
    if (loop.wokeAt === undefined || loop.wokeAt <= loop.since || loop.countedWake === loop.wokeAt) {
      this.deps.state.set(loopKey(conversationId), loop);
      return;
    }
    this.deps.state.set(loopKey(conversationId), { ...loop, cycles: loop.cycles + 1, countedWake: loop.wokeAt } satisfies Loop);
  }

  private woke(conversationId: string) {
    this.deps.state.set(loopKey(conversationId), { ...this.loop(conversationId), wokeAt: this.now() } satisfies Loop);
  }

  private async run(machineId: string, input: SessionSummary | SessionRecord) {
    const id = isRecord(input) ? input.id : input.sessionId;
    if (input.stateVersion === undefined) return;
    const agent = this.deps.control.agents.get(id);
    // A machine can only report on agents the gateway delegated to it.
    if (!agent || agent.machineId !== machineId) return;
    const acted = this.deps.state.get<Acted>(agentKeys.acted(id));
    if (acted && input.stateVersion <= acted.v) return;
    const record = isRecord(input)
      ? input
      : sessionRecord.parse(await this.deps.control.hub.request(machineId, "machine/session", { action: "get", sessionId: id }));
    const v = record.stateVersion;
    if (v === undefined || record.id !== id) return;
    if (acted && v <= acted.v) return;
    this.deps.control.agents.observe(record);
    // Anything newer replaces a result still waiting for the workspace.
    this.deps.state.delete(agentKeys.outbox(id));
    const machineName = this.deps.control.list().find((m) => m.id === machineId)?.name ?? machineId;
    const pushed = await this.routeRequests(agent, machineName, record, acted?.pushed ?? []);
    let stall: string | undefined;
    if (record.status === "running" && record.stalled && record.stalledAt) {
      stall = record.stalledAt;
      if (stall !== acted?.stall) await this.routeResult(agent, machineName, record, "stalled");
    }
    if (TERMINAL.has(record.status)) await this.routeResult(agent, machineName, record, record.status as Reported);
    this.deps.state.set(agentKeys.acted(id), { v, pushed, ...(stall ? { stall } : {}) } satisfies Acted);
  }

  private async push(event: PushEvent) {
    try {
      await this.deps.push(event);
    } catch (err) {
      log.warn({ err, kind: event.kind }, "coding agent push failed");
    }
  }

  /** Needs-you is the owner's to answer, so it pushes and never wakes the agent. */
  private async routeRequests(agent: CodingAgentRecord, machineName: string, record: SessionRecord, pushed: string[]) {
    const open = record.status === "needs-you" ? record.requests : [];
    const ids = open.map((r) => String(r.id));
    const base = { agentId: agent.id, conversationId: agent.conversationId, label: labelOf(agent, machineName) };
    for (const r of open) {
      if (pushed.includes(String(r.id))) continue;
      const d = r.detail;
      // The thing being approved leads; the model's explanation never stands in for it.
      const action = d?.host
        ? `${d.host}${d.command ? `: ${d.command}` : ""}`
        : (d?.command ?? (d?.files?.length
            ? d.files.map((f) => `${f.change} ${f.path}${f.movePath ? ` → ${f.movePath}` : ""}`).join(", ")
            : (d?.grantRoot ?? r.description)));
      await this.push({ kind: "agentNeedsYou", ...base, requestId: String(r.id), description: action });
    }
    for (const requestId of pushed)
      if (!ids.includes(requestId)) await this.push({ kind: "agentResolved", ...base, requestId });
    return ids;
  }

  /** Terminal and stalled agents wake the conversation that started them. */
  private async routeResult(agent: CodingAgentRecord, machineName: string, record: SessionRecord, status: Reported) {
    const result: Result = {
      conversationId: agent.conversationId,
      agentId: agent.id,
      stateVersion: record.stateVersion!,
      status,
      provider: agent.provider,
      title: agent.title,
      machineName: machineName.slice(0, 100),
      ...(record.final ? { final: record.final } : {}),
      ...(record.error ? { error: record.error } : {}),
      ...(record.blocked?.deniedTools.length ? { deniedTools: record.blocked.deniedTools } : {}),
      ...(status !== "completed" && record.output.trim() ? { tail: record.output.slice(-TAIL_MAX) } : {}),
    };
    const deadline = this.now() + (this.deps.workspaceWaitMs ?? 30_000);
    while (!this.deps.link.isConnected() && this.now() < deadline) await Bun.sleep(500);
    const outcome = await this.deliver(result);
    if (outcome === "delivered") return;
    // Kept until a workspace takes it; the owner hears now rather than after an unknown wait.
    if (outcome === "retry")
      this.deps.state.set(agentKeys.outbox(agent.id), { result, attempts: 1, nextAt: this.now() + this.backoff(1) } satisfies Pending);
    const summary = status === "stalled" ? "No output for a while." : (record.error ?? record.final ?? "");
    await this.push({
      kind: "agentResult",
      agentId: agent.id,
      conversationId: agent.conversationId,
      label: labelOf(agent, machineName),
      status,
      text: summary,
    });
  }

  private backoff(attempts: number) {
    return Math.min(OUTBOX_RETRY_MAX_MS, (this.deps.outboxRetryMs || 15_000) * 2 ** (attempts - 1));
  }

  /** "gone": the conversation no longer exists, so no retry can deliver it. */
  private async deliver(result: Result): Promise<"delivered" | "retry" | "gone"> {
    try {
      if ((await this.deps.link.agentResult(result)) !== "delivered") return "retry";
      this.woke(result.conversationId);
      return "delivered";
    } catch (err) {
      if ((err as { code?: unknown }).code === -32040) return "gone";
      log.warn({ err, agentId: result.agentId }, "could not hand a coding agent result to the workspace; keeping it for a retry");
      return "retry";
    }
  }

  /** Retries results a workspace could not take, backing off to hourly; the workspace dedupes repeats. */
  async flushOutbox(): Promise<void> {
    if (!this.deps.link.isConnected()) return;
    for (const pending of this.deps.state.list<Pending>("agent-outbox:")) {
      if (!pending?.result || pending.nextAt > this.now()) continue;
      const key = agentKeys.outbox(pending.result.agentId);
      const outcome = await this.deliver(pending.result);
      // A newer result may have replaced this one meanwhile.
      if (this.deps.state.get<Pending>(key)?.result.stateVersion !== pending.result.stateVersion) continue;
      if (outcome === "retry")
        this.deps.state.set(key, { ...pending, attempts: pending.attempts + 1, nextAt: this.now() + this.backoff(pending.attempts + 1) } satisfies Pending);
      else this.deps.state.delete(key);
    }
  }
}
