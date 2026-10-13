import { expect, test } from "bun:test";
import { AgentEvents, MAX_AUTO_CYCLES } from "./events.ts";
import { CodingAgentStore, type CodingAgentRecord } from "./agents.ts";
import type { SessionRecord } from "./contracts.ts";
import { MemoryJsonState } from "../../db/jsonState.ts";
import type { PushEvent } from "../../surfaces/web/pushRules.ts";
import { pushFor } from "../../surfaces/web/pushRules.ts";

function harness(initial: "delivered" | "unsupported" | "offline" = "delivered") {
  let outcome = initial;
  let now = Date.parse("2026-10-12T12:00:00Z");
  const state = new MemoryJsonState();
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
        if (outcome === "delivered") wakes.push(q);
        return outcome;
      },
    },
    state,
    push: async (e) => void pushes.push(e),
    lastOwnerMessageAt: (id) => owner.get(id),
    now: () => now,
    workspaceWaitMs: 0,
    outboxRetryMs: 0,
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
  return {
    events,
    agents,
    record,
    summary,
    wakes,
    pushes,
    owner,
    state,
    setOutcome: (o: typeof outcome) => (outcome = o),
    advance: (ms: number) => (now += ms),
    now: () => now,
  };
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

test("an old change seen for the first time still acts: the version, not the clock, decides", async () => {
  const h = harness();
  const done = h.record(5, { status: "completed", final: "ok" });
  h.advance(60 * 60_000);
  await h.events.reconcile("pc", h.summary(done));
  expect(h.wakes).toHaveLength(1);
});

test("needs-you pushes the approved command first, never wakes, and silences the notification once answered", async () => {
  const h = harness();
  await h.events.reconcile(
    "pc",
    h.record(2, {
      status: "needs-you",
      requests: [
        {
          id: 7,
          method: "item/commandExecution/requestApproval",
          description: "Run: bun test",
          detail: { kind: "command", command: "bun test", reason: "To check my change is safe and harmless" },
        },
      ],
    }),
  );
  expect(h.pushes).toEqual([expect.objectContaining({ kind: "agentNeedsYou", requestId: "7", label: "Codex agent on Desktop", description: "bun test" })]);
  expect(pushFor(h.pushes[0]!)).toMatchObject({
    title: "Codex agent on Desktop needs approval",
    body: "bun test",
    tag: "agent:a-1:7",
    url: "/chat?agent=a-1",
    requireInteraction: true,
  });
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

test("a result the workspace cannot take pushes the owner and is delivered once a workspace can", async () => {
  for (const outcome of ["unsupported", "offline"] as const) {
    const h = harness(outcome);
    await h.events.reconcile("pc", h.record(2, { status: "completed", final: "Done" }));
    expect(h.pushes).toEqual([expect.objectContaining({ kind: "agentResult", status: "completed", text: "Done" })]);
    expect(pushFor(h.pushes[0]!).title).toBe("Codex agent on Desktop finished");
    h.advance(16_000);
    await h.events.flushOutbox();
    expect(h.wakes).toEqual([]);
    h.setOutcome("delivered");
    h.advance(60_000);
    await h.events.flushOutbox();
    await h.events.flushOutbox();
    expect(h.wakes).toEqual([expect.objectContaining({ agentId: "a-1", stateVersion: 2 })]);
  }
});

test("retries back off after each failed delivery", async () => {
  const h = harness("unsupported");
  await h.events.reconcile("pc", h.record(2, { status: "completed", final: "Done" }));
  const due = () => h.state.list<{ nextAt: number; attempts: number }>("agent-outbox:")[0]!;
  const first = due();
  h.advance(first.nextAt - h.now());
  await h.events.flushOutbox();
  const second = due();
  expect(second.attempts).toBe(2);
  expect(second.nextAt - h.now()).toBe(2 * (first.nextAt - Date.parse("2026-10-12T12:00:00Z")));
});

test("a result for a conversation that no longer exists is dropped, not retried", async () => {
  const h = harness();
  const gone = Object.assign(new Error("Unknown conversation."), { code: -32040 });
  (h as unknown as { events: { deps: { link: { agentResult: () => Promise<never> } } } }).events.deps.link.agentResult = async () => {
    throw gone;
  };
  await h.events.reconcile("pc", h.record(2, { status: "completed", final: "Done" }));
  expect(h.pushes).toEqual([expect.objectContaining({ kind: "agentResult" })]);
  expect(h.state.list("agent-outbox:")).toEqual([]);
});

test("an approval push shows a command exactly as written", async () => {
  const h = harness();
  await h.events.reconcile(
    "pc",
    h.record(2, {
      status: "needs-you",
      requests: [{ id: 1, method: "m", description: "Run", detail: { kind: "command", command: "rm -rf **/__pycache__ `ls`" } }],
    }),
  );
  expect(pushFor(h.pushes[0]!).body).toBe("rm -rf **/__pycache__ `ls`");
});

test("a newer change replaces a result still waiting for the workspace", async () => {
  const h = harness("offline");
  await h.events.reconcile("pc", h.record(2, { status: "completed", final: "first" }));
  await h.events.reconcile("pc", h.record(3, { status: "running" }));
  h.setOutcome("delivered");
  await h.events.flushOutbox();
  expect(h.wakes).toEqual([]);
});

test("only the machine an agent was delegated to can report on it", async () => {
  const h = harness();
  await h.events.reconcile("other", h.record(2, { status: "completed" }));
  expect(h.wakes).toEqual([]);
});

test("a stall wakes once per episode", async () => {
  const h = harness();
  await h.events.reconcile("pc", h.record(2, { stalled: true, stalledAt: "2026-10-12T12:00:00Z" }));
  await h.events.reconcile("pc", h.record(3, { stalled: true, stalledAt: "2026-10-12T12:00:00Z" }));
  expect(h.wakes).toEqual([expect.objectContaining({ status: "stalled" })]);
  await h.events.reconcile("pc", h.record(4));
  await h.events.reconcile("pc", h.record(5, { stalled: true, stalledAt: "2026-10-12T12:30:00Z" }));
  expect(h.wakes).toHaveLength(2);
});

test("after three wake → action cycles without the owner, the conversation's agent is paused until the owner replies", async () => {
  const h = harness();
  let v = 1;
  const wake = () => h.events.reconcile("pc", h.record(++v, { status: "completed", final: "ok" }));
  // Starting several agents in one turn, or acting without a wake, is not an automatic cycle.
  h.events.noteAction("main", "agent");
  h.events.noteAction("main", "agent");
  for (let i = 0; i < MAX_AUTO_CYCLES; i++) {
    h.advance(1000);
    await wake();
    h.advance(1000);
    h.events.guard("main");
    h.events.noteAction("main", "agent");
    h.events.noteAction("main", "agent");
  }
  h.advance(1000);
  await wake();
  expect(() => h.events.guard("main")).toThrow("paused after 3 automatic follow-ups");
  expect(() => h.events.guard("main")).toThrow("paused");
  // The owner hears once per pause, not on every refused call.
  expect(h.pushes).toEqual([expect.objectContaining({ kind: "agentsPaused", conversationId: "main", cycles: 3 })]);
  // Another conversation is unaffected.
  h.events.guard("topic-1");
  h.advance(1000);
  h.owner.set("main", h.now());
  h.advance(1000);
  h.events.guard("main");
  // An owner action in the app resets it as well.
  h.events.noteAction("main", "owner");
  h.events.guard("main");
});
