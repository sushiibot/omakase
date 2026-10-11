import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { DurableState } from "../agentRuntime/durableState.ts";
import type { Wake } from "./personalSession.ts";
import { TaskStore } from "./taskStore.ts";
import type { TopicSessions } from "./topicSessions.ts";
import {
  deliverScheduledCheck,
  WakeupManager,
  type ScheduledCheck,
} from "./wakeups.ts";

let root: string;
let now: Date;
let deliveries: { check: ScheduledCheck; wake: Wake }[];
let warnings: unknown[];
let managers: WakeupManager[];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ws-wakeups-"));
  now = new Date("2026-10-11T20:00:00Z");
  deliveries = [];
  warnings = [];
  managers = [];
});
afterEach(async () => {
  await Promise.all(managers.map((m) => m.stop()));
  rmSync(root, { recursive: true, force: true });
});
const WEB = { surface: "web", conversationId: "trip" };
const DM = { surface: "discord", conversationId: "123456789" };
const args = {
  key: "flight-status",
  title: "Check flight status",
  prompt: "Check flight FA107. Notify only on a delay.",
  at: "2026-10-12T15:30:00-07:00",
};
async function manager(
  extra: Partial<ConstructorParameters<typeof WakeupManager>[0]> = {},
) {
  const m = new WakeupManager({
    stateDir: root,
    timeZone: "America/Los_Angeles",
    now: () => now,
    conversationExists: (id) => ["main", "trip", "lease"].includes(id),
    deliver: async (check, wake) => {
      deliveries.push({ check, wake });
    },
    warn: (err) => warnings.push(err),
    ...extra,
  });
  await m.open();
  managers.push(m);
  return m;
}
async function call(tools: ToolDefinition[], name: string, raw: unknown) {
  const result = await tools
    .find((t) => t.name === name)!
    .execute("test", raw, undefined, undefined, {} as never);
  return JSON.parse(
    result.content.map((c) => ("text" in c ? c.text : "")).join(""),
  );
}

test("absolute dates respect offsets, remain pending until consumed, and survive restart", async () => {
  const m = await manager();
  const { check } = m.schedule(args, WEB);
  expect(check).toMatchObject({
    at: "2026-10-12T22:30:00.000Z",
    timeZone: "America/Los_Angeles",
    origin: WEB,
    conversationId: "trip",
  });
  await m.tick();
  expect(deliveries).toHaveLength(0);
  await m.stop();
  const restored = await manager();
  now = new Date("2026-10-13T10:00:00Z");
  await restored.start();
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0].wake.text).toContain(
    "existing unresolved questions/approvals",
  );
  expect(restored.list()).toHaveLength(1);
  await restored.tick();
  expect(deliveries).toHaveLength(1);
  deliveries[0].wake.onConsumed();
  expect(restored.list()).toHaveLength(0);
  await restored.stop();
  expect((await manager()).list(true)[0].status).toBe("consumed");
});

test("repeated purpose keys reuse one pending check and other items remain independent", async () => {
  const m = await manager();
  const first = m.schedule(args, WEB);
  const duplicate = m.schedule(
    { ...args, at: "2026-10-15T10:00:00Z", prompt: "Different instructions" },
    WEB,
  );
  expect(duplicate).toEqual({ check: first.check, existing: true });
  m.schedule(args, { surface: "web", conversationId: "lease" });
  m.schedule({ ...args, key: "seat-choice" }, WEB);
  expect(m.list()).toHaveLength(3);
});

test("Discord main checks keep their delivery surface and dedupe against web Main", async () => {
  const m = await manager();
  const first = m.schedule(args, DM);
  expect(first.check).toMatchObject({ origin: DM, conversationId: "main" });
  expect(m.schedule(args, { surface: "web", conversationId: "main" })).toEqual({
    check: first.check,
    existing: true,
  });
  const targeted = m.schedule({ ...args, conversationId: "lease" }, DM);
  expect(targeted.check.origin).toEqual({
    surface: "web",
    conversationId: "lease",
  });
});

test("rescheduling invalidates a queued wake and produces one wake at the replacement time", async () => {
  const m = await manager();
  const { check } = m.schedule(args, WEB);
  now = new Date(check.at);
  await m.tick();
  const previous = deliveries[0].wake;
  const replacement = m.reschedule({
    id: check.id,
    at: "2026-10-14T10:00:00Z",
  });
  expect(previous.isPending!()).toBe(false);
  // A stale acknowledgement cannot consume the replacement.
  previous.onConsumed();
  expect(m.list()).toEqual([replacement]);
  await m.tick();
  expect(deliveries).toHaveLength(1);
  now = new Date(replacement.at);
  await m.tick();
  expect(deliveries).toHaveLength(2);
  expect(deliveries[1].wake.id).not.toBe(previous.id);
  deliveries[1].wake.onConsumed();
  expect(m.list()).toEqual([]);
});

test("cancel invalidates a wake already queued behind a busy conversation", async () => {
  const m = await manager();
  const { check } = m.schedule(args, WEB);
  now = new Date(check.at);
  await m.tick();
  m.cancel(check.id);
  expect(deliveries[0].wake.isPending!()).toBe(false);
  deliveries[0].wake.onConsumed();
  expect(m.list(true)[0].status).toBe("cancelled");
  expect(m.cancel(check.id).status).toBe("cancelled");
});

test("failed dispatch retries without losing or consuming the promise", async () => {
  let attempts = 0;
  const m = await manager({
    deliver: async (check, wake) => {
      if (++attempts === 1)
        throw new Error("workspace temporarily unavailable");
      deliveries.push({ check, wake });
    },
  });
  m.schedule(args, WEB);
  now = new Date("2026-10-13T10:00:00Z");
  await m.tick();
  expect(warnings).toHaveLength(1);
  expect(m.list()).toHaveLength(1);
  await m.tick();
  expect(attempts).toBe(2);
  expect(deliveries).toHaveLength(1);
});

test("a prompt failure releases the queued check and disconnected checks wait for registration", async () => {
  let ready = false;
  const m = await manager({ ready: () => ready });
  m.schedule(args, WEB);
  now = new Date("2026-10-13T10:00:00Z");
  await m.start();
  expect(deliveries).toHaveLength(0);
  ready = true;
  await m.tick();
  deliveries[0].wake.onFailed!(new Error("temporary model failure"));
  await m.tick();
  expect(deliveries).toHaveLength(2);
  expect(m.list()).toHaveLength(1);
  deliveries[1].wake.onConsumed();
  deliveries[1].wake.onFailed!(new Error("failure after consumption"));
  await m.tick();
  expect(deliveries).toHaveLength(2);
});

test("explicit offsets disambiguate daylight-saving repeated hours", async () => {
  const m = await manager();
  const early = m.schedule(
    { ...args, key: "early", at: "2026-11-01T01:30:00-07:00" },
    WEB,
  ).check;
  const late = m.schedule(
    { ...args, key: "late", at: "2026-11-01T01:30:00-08:00" },
    WEB,
  ).check;
  expect(Date.parse(late.at) - Date.parse(early.at)).toBe(3_600_000);
  for (const at of [
    "2026-10-12T15:30:00",
    "2026-02-30T15:30:00Z",
    "2020-01-01T00:00:00Z",
  ])
    expect(() => m.schedule({ ...args, key: "bad", at }, WEB)).toThrow();
  expect(() =>
    m.schedule({ ...args, timeZone: "Mars/Olympus" }, WEB),
  ).toThrow();
  expect(() => m.schedule({ ...args, conversationId: "unknown" }, WEB)).toThrow(
    "Unknown conversation",
  );
  expect(m.list()).toHaveLength(2);
});

test("a damaged workspace database fails opening instead of losing promised checks", async () => {
  writeFileSync(join(root, "workspace.sqlite"), "not a database");
  const m = new WakeupManager({
    stateDir: root,
    timeZone: "UTC",
    conversationExists: () => true,
    deliver: async () => {},
  });
  await expect(m.open()).rejects.toThrow();
});

test("a failed durable checkpoint cannot acknowledge a scheduled check", async () => {
  const store = new DurableState(root);
  const m = await manager({ store });
  await store.close();
  await expect(
    call(
      m.tools(() => WEB),
      "schedule_check",
      args,
    ),
  ).rejects.toThrow();
  await expect(m.flush()).rejects.toThrow();
  managers.splice(managers.indexOf(m), 1);
  await m.stop().catch(() => {});
  const restored = await manager();
  expect(restored.list()).toEqual([]);
});

test("tools expose shared checks and mutate the existing check through its lifecycle", async () => {
  const m = await manager();
  const tools = m.tools(() => WEB);
  const scheduled = await call(tools, "schedule_check", args);
  expect((await call(tools, "list_scheduled_checks", {})).checks).toEqual([
    scheduled.check,
  ]);
  const rescheduled = await call(tools, "reschedule_check", {
    id: scheduled.check.id,
    at: "2026-10-15T12:00:00Z",
  });
  expect(rescheduled.id).toBe(scheduled.check.id);
  expect(
    (await call(tools, "cancel_scheduled_check", { id: scheduled.check.id }))
      .status,
  ).toBe("cancelled");
  expect((await call(tools, "list_scheduled_checks", {})).checks).toEqual([]);
  expect(
    (await call(tools, "list_scheduled_checks", { includeFinished: true }))
      .checks,
  ).toHaveLength(1);
});

test("awareness shares pending-check metadata across conversations without copying prompts", async () => {
  const m = await manager();
  const { check } = m.schedule(args, WEB);
  const handlers = new Map<string, (...args: any[]) => any>();
  m.awareness()({
    on: (event: string, handler: (...args: any[]) => any) =>
      handlers.set(event, handler),
  } as unknown as ExtensionAPI);
  handlers.get("before_agent_start")!();
  const out = handlers.get("context_with_system")!({
    messages: [{ role: "system", sections: {} }],
  });
  const context = out.messages[0].sections.scheduledChecks;
  expect(context).toContain(check.id);
  expect(context).toContain('"conversationId":"trip"');
  expect(context).not.toContain(args.prompt);
});

describe("persistent task checks", async () => {
  async function setupTask() {
    const tasks = new TaskStore(join(root, "state"), join(root, "home"));
    const task = tasks.manage({
      action: "create",
      title: "Flight",
      conversationId: "trip",
    }).tasks[0];
    const m = await manager({ tasks });
    return { tasks, task, m };
  }
  test("a task purpose is deduped across conversation callers and completed tasks cancel checks", async () => {
    const { tasks, task, m } = await setupTask();
    const first = m.schedule({ ...args, taskId: task.id }, WEB);
    expect(m.schedule({ ...args, taskId: task.id }, DM)).toEqual({
      check: first.check,
      existing: true,
    });
    tasks.manage({
      action: "update",
      id: task.id,
      revision: task.revision,
      patch: { status: "done" },
    });
    await m.tick();
    expect(m.list()).toEqual([]);
    expect(m.list(true)[0].reason).toBe("Task completed or cancelled");
    expect(() => m.schedule({ ...args, taskId: task.id }, WEB)).toThrow(
      "already complete",
    );
    expect(deliveries).toHaveLength(0);
  });
  test("completion while a wake is queued prevents its later prompt", async () => {
    const { tasks, task, m } = await setupTask();
    m.schedule({ ...args, taskId: task.id }, WEB);
    now = new Date("2026-10-13T10:00:00Z");
    await m.tick();
    tasks.manage({
      action: "update",
      id: task.id,
      revision: task.revision,
      patch: { status: "cancelled" },
    });
    expect(deliveries[0].wake.isPending!()).toBe(false);
    expect(m.list(true)[0].status).toBe("cancelled");
  });
  test("delivery binds and resumes the task's own conversation instead of duplicating the task", async () => {
    const { tasks, task, m } = await setupTask();
    const check = m.schedule({ ...args, taskId: task.id }, WEB).check;
    const created: any[] = [];
    const routed: any[] = [];
    const wakes: Wake[] = [];
    const topics = {
      manage: async (p: unknown) => {
        created.push(p);
      },
      session: async (origin: unknown) => {
        routed.push(origin);
        return { wake: (w: Wake) => wakes.push(w) };
      },
    } as unknown as TopicSessions;
    const wake: Wake = {
      id: "check",
      text: "Check",
      isPending: () => true,
      onConsumed: () => {},
    };
    await deliverScheduledCheck(topics, tasks, check, wake, async (id) => {
      created.push({ id });
      tasks.manage({ action: "bind", id, conversationId: `task-${id}` });
    });
    expect(created[0]).toEqual({ id: task.id });
    expect(tasks.get(task.id).workConversationId).toBe(`task-${task.id}`);
    expect(routed).toEqual([
      { surface: "web", conversationId: `task-${task.id}` },
    ]);
    expect(wakes[0].origin).toEqual(routed[0]);
    expect(tasks.list()).toHaveLength(1);
  });
  test("checks created within a task conversation infer the task association", async () => {
    const { tasks, task, m } = await setupTask();
    tasks.manage({ action: "bind", id: task.id, conversationId: "lease" });
    const check = m.schedule(args, {
      surface: "web",
      conversationId: "lease",
    }).check;
    expect(check.taskId).toBe(task.id);
    expect(check.conversationId).toBe("lease");
  });
});
