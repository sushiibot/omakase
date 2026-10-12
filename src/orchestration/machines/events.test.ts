import { expect, test } from "bun:test";
import { AgentEvents, MAX_AUTO_CYCLES } from "./events.ts";
import { CodingAgentStore, type CodingAgentRecord } from "./agents.ts";
import type { SessionRecord } from "./contracts.ts";
import type { JsonState } from "../../db/jsonState.ts";
import type { PushEvent } from "../../surfaces/web/pushRules.ts";
import { pushFor } from "../../surfaces/web/pushRules.ts";

class MemoryState implements JsonState {
  map = new Map<string, string>();
  get<T>(key: string) {
    const v = this.map.get(key);
    return v === undefined ? undefined : (JSON.parse(v) as T);
  }
  set(key: string, value: unknown) {
    this.map.set(key, JSON.stringify(value));
  }
  list<T>(prefix: string) {
    return [...this.map].filter(([k]) => k.startsWith(prefix)).map(([, v]) => JSON.parse(v) as T);
  }
}

function harness(outcome: "delivered" | "unsupported" | "offline" = "delivered") {
  let now = Date.parse("2026-10-12T12:00:00Z");
  const state = new MemoryState();
  const agents = new CodingAgentStore(state);
  const at = new Date(now).toISOString();
  const agent: CodingAgentRecord = {
    id: "a-1",
    machineId: "pc",
    rootId: "code",
    provider: "codex",
    title: "Fix login",
    prompt: "Fix login",
    conversationId: "main",
    createdAt: at,
    updatedAt: at,
  };
  agents.put(agent);
  const sessions = new Map<string, SessionRecord>();
  const wakes: unknown[] = [];
  const pushes: PushEvent[] = [];
  const owner = new Map<string, number>();
  const events = new AgentEvents({
    control: {
      hub: {
        request: async (_m: string, _method: string, p: any) => structuredClone(sessions.get(p.sessionId)),
      } as never,
      agents,
      list: () => [{ id: "pc", name: "Desktop", connected: true, roots: [], providers: [] }],
    },
    link: {
      isConnected: () => outcome !== "offline",
      agentResult: async (q) => {
        wakes.push(q);
        return outcome;
      },
    },
    state,
    push: async (e) => void pushes.push(e),
    lastOwnerMessageAt: (id) => owner.get(id),
    now: () => now,
    workspaceWaitMs: 0,
  });
  const record = (v: number, patch: Partial<SessionRecord> = {}): SessionRecord => {
    const r: SessionRecord = {
      id: "a-1",
      taskId: "",
      rootId: "code",
      provider: "codex",
      status: "running",
      output: "line one\nline two",
      updatedAt: new Date(now).toISOString(),
      attempts: 1,
      requests: [],
      promptIds: [],
      stateVersion: v,
      ...patch,
    };
    sessions.set(r.id, r);
    return r;
  };
  const summary = (r: SessionRecord) => ({ sessionId: r.id, taskId: "", stateVersion: r.stateVersion!, status: r.status });
  return { events, agents, record, summary, wakes, pushes, owner, state, advance: (ms: number) => (now += ms) };
}

test("a finished agent wakes its conversation once, however often the change is reported", async () => {
  const h = harness();
  const done = h.record(2, { status: "completed", final: "All tests pass." });
  await h.events.reconcile("pc", h.summary(done));
  await h.events.reconcile("pc", h.summary(done));
  await h.events.reconcile("pc", done);
  expect(h.wakes).toEqual([
    expect.objectContaining({ conversationId: "main", agentId: "a-1", stateVersion: 2, status: "completed", final: "All tests pass.", machineName: "Desktop" }),
  ]);
  expect((h.wakes[0] as { tail?: string }).tail).toBeUndefined();
  expect(h.agents.get("a-1")).toMatchObject({ remoteStatus: "completed", stateVersion: 2 });
  expect(h.pushes).toEqual([]);
});

test("needs-you pushes the owner, never wakes, and silences the notification once answered", async () => {
  const h = harness();
  await h.events.reconcile("pc", h.record(2, { status: "needs-you", requests: [{ id: 7, method: "x", description: "Run bun test" }] }));
  expect(h.pushes).toEqual([expect.objectContaining({ kind: "agentNeedsYou", requestId: "7", label: "Codex agent on Desktop" })]);
  expect(pushFor(h.pushes[0]!)).toMatchObject({ title: "Codex agent on Desktop needs approval", tag: "agent:a-1:7", url: "/chat", requireInteraction: true });
  await h.events.reconcile("pc", h.record(3, { status: "running" }));
  expect(h.pushes[1]).toMatchObject({ kind: "agentResolved", requestId: "7" });
  expect(pushFor(h.pushes[1]!)).toMatchObject({ tag: "agent:a-1:7", silent: true });
  expect(h.wakes).toEqual([]);
});

test("a failed or interrupted agent wakes with its output tail; a stopped one tells nobody", async () => {
  const h = harness();
  await h.events.reconcile("pc", h.record(2, { status: "failed", error: "model overloaded" }));
  expect(h.wakes[0]).toMatchObject({ status: "failed", error: "model overloaded", tail: "line one\nline two" });
  await h.events.reconcile("pc", h.record(3, { status: "stopped" }));
  expect(h.wakes).toHaveLength(1);
  expect(h.pushes).toEqual([]);
});

test("without a workspace that takes the result, the owner is pushed instead", async () => {
  for (const outcome of ["unsupported", "offline"] as const) {
    const h = harness(outcome);
    await h.events.reconcile("pc", h.record(2, { status: "completed", final: "Done" }));
    expect(h.pushes).toEqual([expect.objectContaining({ kind: "agentResult", status: "completed", text: "Done" })]);
    expect(pushFor(h.pushes[0]!).title).toBe("Codex agent on Desktop finished");
  }
});

test("only the machine an agent was delegated to can report on it, and old changes are a baseline", async () => {
  const h = harness();
  await h.events.reconcile("other", h.record(2, { status: "completed" }));
  expect(h.wakes).toEqual([]);
  const old = h.record(5, { status: "completed" });
  h.advance(60 * 60_000);
  await h.events.reconcile("pc", h.summary(old));
  expect(h.wakes).toEqual([]);
  // The next real change acts.
  await h.events.reconcile("pc", h.record(6, { status: "failed", error: "x" }));
  expect(h.wakes).toHaveLength(1);
});

test("a stall wakes once per episode", async () => {
  const h = harness();
  await h.events.reconcile("pc", h.record(2, { stalled: true, stalledAt: "2026-10-12T12:00:00Z" }));
  await h.events.reconcile("pc", h.record(3, { stalled: true, stalledAt: "2026-10-12T12:00:00Z", requests: [] }));
  expect(h.wakes).toEqual([expect.objectContaining({ status: "stalled" })]);
  await h.events.reconcile("pc", h.record(4));
  await h.events.reconcile("pc", h.record(5, { stalled: true, stalledAt: "2026-10-12T12:30:00Z" }));
  expect(h.wakes).toHaveLength(2);
});

test("automatic message cycles stop waking after the limit until the owner speaks", async () => {
  const h = harness();
  let v = 1;
  const finish = () => h.events.reconcile("pc", h.record(++v, { status: "completed", final: "ok" }));
  await finish();
  for (let i = 0; i < MAX_AUTO_CYCLES; i++) {
    h.advance(1000);
    h.events.noteAction("a-1", "agent", true);
    await finish();
  }
  expect(h.wakes).toHaveLength(MAX_AUTO_CYCLES);
  expect(h.pushes.at(-1)).toMatchObject({ kind: "agentResult" });
  expect((h.pushes.at(-1) as { text: string }).text).toContain("paused");
  h.advance(1000);
  h.owner.set("main", Date.parse("2026-10-12T12:00:00Z") + 10 * 60_000);
  h.advance(10 * 60_000);
  h.events.noteAction("a-1", "agent", true);
  await finish();
  expect(h.wakes).toHaveLength(MAX_AUTO_CYCLES + 1);
  // An owner action from the app resets the count too.
  h.events.noteAction("a-1", "owner", true);
  expect(h.state.get<{ count: number }>("agent-loop:a-1")!.count).toBe(0);
});
