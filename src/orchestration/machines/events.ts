import {
  sessionRecord,
  type AgentResultParams,
  type SessionRecord,
  type SessionSummary,
} from "./contracts.ts";
import type { ActionOrigin, MachineControl, SessionObserver } from "./control.ts";
import type { CodingAgentRecord } from "./agents.ts";
import type { WorkspaceLink } from "../workspace/link.ts";
import type { JsonState } from "../../db/jsonState.ts";
import type { PushEvent } from "../../surfaces/web/pushRules.ts";
import { getLogger } from "../../logger.ts";

const log = getLogger("agent-events");
type Reported = AgentResultParams["status"];
const TERMINAL = new Set<string>(["completed", "failed", "interrupted"]);
/** Automatic wake → message cycles an agent may run before the owner hears about it instead. */
export const MAX_AUTO_CYCLES = 3;
/** A session first seen with an older change was handled before this gateway tracked it. */
const FIRST_SIGHT_MS = 10 * 60_000;
const TAIL_MAX = 2000;

interface Acted {
  v: number;
  /** Provider request ids the owner was notified about and not yet told were answered. */
  pushed: string[];
  /** The stall episode (its stalledAt) already reported, so one stall wakes the agent once. */
  stall?: string;
}
interface Loop {
  count: number;
  since: number;
}
export interface AgentEventDeps {
  control: Pick<MachineControl, "hub" | "agents" | "list">;
  link: Pick<WorkspaceLink, "agentResult" | "isConnected">;
  state: JsonState;
  push(event: PushEvent): Promise<unknown>;
  lastOwnerMessageAt(conversationId: string): number | undefined;
  now?(): number;
  /** How long a result waits for a reconnecting workspace before it is pushed instead. */
  workspaceWaitMs?: number;
}

const actedKey = (id: string) => `agent-acted:${id}`;
const loopKey = (id: string) => `agent-loop:${id}`;
const isRecord = (v: SessionSummary | SessionRecord): v is SessionRecord => "id" in v;

/** "Codex agent on Desktop": how the owner and the agent name a coding agent. */
export function agentLabel(provider: CodingAgentRecord["provider"], machineName: string) {
  return `${provider === "codex" ? "Codex" : "Claude Code"} agent on ${machineName}`;
}

/**
 * Level-triggered: every trigger (live event, connect snapshot, a read of the agent) compares the session's
 * stateVersion with the last one acted on, so a duplicate or missed event never acts twice or not at all.
 */
export class AgentEvents implements SessionObserver {
  private queues = new Map<string, Promise<void>>();
  constructor(private deps: AgentEventDeps) {}

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

  noteAction(agentId: string, origin: ActionOrigin, followUp: boolean): void {
    const now = this.now();
    if (origin === "owner") {
      this.deps.state.set(loopKey(agentId), { count: 0, since: now } satisfies Loop);
      return;
    }
    if (!followUp) return;
    const agent = this.deps.control.agents.get(agentId);
    const loop = agent ? this.loop(agent) : { count: 0, since: 0 };
    this.deps.state.set(loopKey(agentId), { count: loop.count + 1, since: now } satisfies Loop);
  }

  /** The automatic cycle count, reset by an owner message in the agent's conversation since the last count. */
  private loop(agent: CodingAgentRecord): Loop {
    const loop = this.deps.state.get<Loop>(loopKey(agent.id)) ?? { count: 0, since: 0 };
    const owner = this.deps.lastOwnerMessageAt(agent.conversationId);
    return owner !== undefined && owner > loop.since ? { count: 0, since: owner } : loop;
  }

  private async run(machineId: string, input: SessionSummary | SessionRecord) {
    const id = isRecord(input) ? input.id : input.sessionId;
    if (input.stateVersion === undefined) return;
    const agent = this.deps.control.agents.get(id);
    // A machine can only report on agents the gateway delegated to it.
    if (!agent || agent.machineId !== machineId) return;
    const acted = this.deps.state.get<Acted>(actedKey(id));
    if (acted && input.stateVersion <= acted.v) return;
    const record = isRecord(input)
      ? input
      : sessionRecord.parse(await this.deps.control.hub.request(machineId, "machine/session", { action: "get", sessionId: id }));
    const v = record.stateVersion;
    if (v === undefined || record.id !== id) return;
    if (acted && v <= acted.v) return;
    this.deps.control.agents.observe(record);
    const done = (pushed: string[], stall?: string) =>
      this.deps.state.set(actedKey(id), { v, pushed, ...(stall ? { stall } : {}) } satisfies Acted);
    if (!acted) {
      const at = Date.parse(record.turn?.endedAt ?? record.updatedAt);
      if (!(this.now() - at < FIRST_SIGHT_MS)) return done([], record.stalledAt);
    }
    const machineName = this.deps.control.list().find((m) => m.id === machineId)?.name ?? machineId;
    const label = agentLabel(agent.provider, machineName);
    const pushed = await this.routeRequests(agent, label, record, acted?.pushed ?? []);
    let stall: string | undefined;
    if (record.status === "running" && record.stalled && record.stalledAt) {
      stall = record.stalledAt;
      if (stall !== acted?.stall) await this.routeResult(agent, machineName, record, "stalled");
    }
    if (TERMINAL.has(record.status)) await this.routeResult(agent, machineName, record, record.status as Reported);
    done(pushed, stall);
  }

  private async push(event: PushEvent) {
    try {
      await this.deps.push(event);
    } catch (err) {
      log.warn({ err, kind: event.kind }, "coding agent push failed");
    }
  }

  /** Needs-you is the owner's to answer, so it pushes and never wakes the agent. */
  private async routeRequests(agent: CodingAgentRecord, label: string, record: SessionRecord, pushed: string[]) {
    const open = record.status === "needs-you" ? record.requests : [];
    const ids = open.map((r) => String(r.id));
    const base = { agentId: agent.id, conversationId: agent.conversationId, label };
    for (const r of open)
      if (!pushed.includes(String(r.id)))
        await this.push({ kind: "agentNeedsYou", ...base, requestId: String(r.id), description: r.description });
    for (const requestId of pushed)
      if (!ids.includes(requestId)) await this.push({ kind: "agentResolved", ...base, requestId });
    return ids;
  }

  /** Terminal and stalled agents wake the conversation that started them; the owner is pushed only when that is impossible. */
  private async routeResult(agent: CodingAgentRecord, machineName: string, record: SessionRecord, status: Reported) {
    const label = agentLabel(agent.provider, machineName);
    const summary = status === "stalled" ? "No output for a while." : (record.error ?? record.final ?? "");
    const fallback = (text: string) =>
      this.push({ kind: "agentResult", agentId: agent.id, conversationId: agent.conversationId, label, status, text });
    const loop = this.loop(agent);
    this.deps.state.set(loopKey(agent.id), loop);
    if (loop.count >= MAX_AUTO_CYCLES) return fallback(`Automatic follow-ups paused after ${loop.count} messages. ${summary}`);
    try {
      const deadline = this.now() + (this.deps.workspaceWaitMs ?? 30_000);
      while (!this.deps.link.isConnected() && this.now() < deadline) await Bun.sleep(500);
      const outcome = await this.deps.link.agentResult({
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
      });
      if (outcome === "delivered") return;
    } catch (err) {
      log.warn({ err, agentId: agent.id }, "could not wake the conversation with a coding agent result; notifying the owner");
    }
    await fallback(summary);
  }
}
