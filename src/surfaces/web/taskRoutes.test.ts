import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../../workspace/taskStore.ts";
import { CLIENT_ID_RE } from "./events.ts";
import { TaskService } from "./application/taskService.ts";
import { TaskRoutes } from "./taskRoutes.ts";
import type { WebThreads } from "./threadRoutes.ts";
import type { TaskRequest } from "../../orchestration/taskContracts.ts";
import { mintWebActor } from "./actor.ts";
import { AgentEvents, MAX_AUTO_CYCLES } from "../../orchestration/machines/events.ts";
import { CodingAgentStore } from "../../orchestration/machines/agents.ts";
import { MemoryJsonState } from "../../db/jsonState.ts";
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function setup() {
  const home = mkdtempSync(join(tmpdir(), "task-routes-"));
  dirs.push(home);
  const store = new TaskStore(join(home, "state"), home);
  const sent: { id: string; path: string; body: unknown }[] = [];
  const channels = new Set<string>();
  const stopped: string[] = [];
  const threads = {
    taskNeedsInput: () => false,
    async ensureTask(id: string) {
      channels.add(id);
    },
    conversation(id: string) {
      if (!channels.has(id)) throw new Error("No channel");
      return {
        async submit(body: unknown) {
          sent.push({ id, path: "/api/chat/messages", body });
          return { kind: "accepted", seq: 1, routed: false };
        },
        async stop(body: unknown) {
          sent.push({ id, path: "/api/chat/stop", body });
          return { kind: "accepted" };
        },
      };
    },
  } as unknown as WebThreads;
  const service = new TaskService(
    {
      tasksManage: async (request: TaskRequest) => store.manage(request),
      runsStop: async (id: string) => {
        stopped.push(id);
        return { stopped: true };
      },
    },
    threads,
  );
  const actor = mintWebActor("owner@example.com", "Owner");
  return { service, routes: new TaskRoutes(service, threads), store, actor, sent, stopped, channels };
}
test("manual create stays a to-do; repeated start and prompts use one isolated task channel", async () => {
  const { service, store, actor, sent, channels } = setup();
  const task = (
    await service.action(
      { action: "create", title: "Renew passport" },
      actor,
      "trip",
    )
  ).tasks[0]!;
  expect(task.status).toBe("todo");
  expect(task.sourceConversationId).toBe("trip");
  expect(sent).toHaveLength(0);
  await Promise.all([
    service.action(
      { action: "start", id: task.id, text: "Check requirements" },
      actor,
    ),
    service.action(
      { action: "start", id: task.id, text: "Also check dates" },
      actor,
    ),
  ]);
  expect(
    sent.every((s) =>
      CLIENT_ID_RE.test((s.body as { clientId: string }).clientId),
    ),
  ).toBe(true);
  expect(channels.size).toBe(1);
  expect(sent.map((s) => s.id)).toEqual([`task-${task.id}`, `task-${task.id}`]);
  expect(sent.every((s) => s.id !== "main")).toBe(true);
  expect(store.get(task.id).workConversationId).toBe(`task-${task.id}`);
  expect((sent[1]!.body as { text: string }).text).toBe("Also check dates");
});
test("stopping work keeps the task and checklist available to resume", async () => {
  const { service, store, actor, sent, stopped } = setup();
  let task = (
    await service.action({ action: "create", title: "Fix login" }, actor)
  ).tasks[0]!;
  await service.action({ action: "start", id: task.id }, actor);
  task = store.get(task.id);
  store.manage({
    action: "update",
    id: task.id,
    revision: task.revision,
    patch: { checklist: [{ id: "test", title: "Verify expiry", done: false }] },
  });
  store.attachRun(task.id, "run-1", "coder");
  const result = await service.action({ action: "stop", id: task.id }, actor);
  expect(stopped).toEqual(["run-1"]);
  expect(sent.at(-1)?.path).toBe("/api/chat/stop");
  expect(result.tasks[0]!.status).toBe("todo");
  expect(result.tasks[0]!.checklist).toHaveLength(1);
});

test("prepare creates one task conversation without starting work and refuses completed tasks", async () => {
  const { service, store, actor, sent, channels } = setup();
  const task = (await service.action({ action: "create", title: "Check delivery" }, actor)).tasks[0]!;
  await service.action({ action: "prepare", id: task.id }, actor);
  await service.action({ action: "prepare", id: task.id }, actor);
  const prepared = store.get(task.id);
  expect(prepared.workConversationId).toBe(`task-${task.id}`);
  expect(prepared.status).toBe("todo");
  expect(prepared.runIds).toEqual([]);
  expect(channels.size).toBe(1);
  expect(sent).toEqual([]);
  store.manage({ action: "update", id: task.id, revision: prepared.revision, patch: { status: "done" } });
  await expect(service.action({ action: "prepare", id: task.id }, actor)).rejects.toThrow("already complete");
});

test("stopping a parent also stops child runs and task conversations", async () => {
  const { service, store, actor, sent, stopped } = setup();
  const parent = (await service.action({ action: "create", title: "Ship login" }, actor)).tasks[0]!;
  const child = (await service.action({ action: "create", title: "Test login", parentTaskId: parent.id }, actor)).tasks[0]!;
  await service.action({ action: "start", id: parent.id }, actor);
  await service.action({ action: "start", id: child.id }, actor);
  store.attachRun(parent.id, "parent-run", "Sushii");
  store.attachRun(child.id, "child-run", "coder");
  await service.action({ action: "stop", id: parent.id }, actor);
  expect(stopped).toEqual(["parent-run", "child-run"]);
  expect(sent.filter(s => s.path === "/api/chat/stop").map(s => s.id)).toEqual([`task-${parent.id}`, `task-${child.id}`]);
  expect(store.get(child.id).status).toBe("todo");
});

test("an agent at the automatic-cycle cap cannot reset it by starting a task: only the owner's own message does", async () => {
  const home = mkdtempSync(join(tmpdir(), "task-routes-"));
  dirs.push(home);
  const store = new TaskStore(join(home, "state"), home);
  // The owner's last message per conversation, as the gateway reads it: agent-posted messages skipped.
  const ownerAt = new Map<string, number>();
  let now = 1_000_000;
  const threads = {
    taskNeedsInput: () => false,
    async ensureTask() {},
    conversation(id: string) {
      return {
        async submit(_body: unknown, _actor: unknown, origin: string) {
          if (origin !== "agent") ownerAt.set(id, ++now);
          return { kind: "accepted", seq: 1, routed: false };
        },
      };
    },
  } as unknown as WebThreads;
  const service = new TaskService({ tasksManage: async (r: TaskRequest) => store.manage(r), runsStop: async () => ({ stopped: true }) }, threads);
  const state = new MemoryJsonState();
  const events = new AgentEvents({
    control: { hub: {} as never, agents: new CodingAgentStore(state), list: () => [] },
    link: { isConnected: () => true, agentResult: async () => "delivered" },
    state,
    push: async () => {},
    lastOwnerMessageAt: (id) => ownerAt.get(id),
    now: () => now,
    outboxRetryMs: 0,
  });
  const actor = mintWebActor("owner@example.com", "Owner");
  const task = (await service.action({ action: "create", title: "Fix login" }, actor)).tasks[0]!;
  const conversation = `task-${task.id}`;
  state.set(`agent-loop:${conversation}`, { cycles: MAX_AUTO_CYCLES, since: 0 });
  expect(() => events.guard(conversation)).toThrow("paused");
  await service.action({ action: "start", id: task.id, text: "keep going" }, actor, conversation, "agent");
  now += 10;
  expect(() => events.guard(conversation)).toThrow("paused");
  await service.action({ action: "start", id: task.id, text: "go on" }, actor, conversation, "owner");
  now += 10;
  expect(() => events.guard(conversation)).not.toThrow();
});

test("HTTP and direct task operations use the same service and preserve validation mapping", async () => {
  const { service, routes, actor, store } = setup();
  const created = (await service.action({ action: "create", title: "Shared service" }, actor)).tasks[0]!;
  const res = await routes.handle(new Request("http://local/api/tasks"), "/api/tasks", actor);
  expect(res!.status).toBe(200);
  expect(await res!.json()).toEqual(await service.action({ action: "list" }, actor));
  const started = await routes.handle(new Request("http://local/api/tasks", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "start", id: created.id }),
  }), "/api/tasks", actor);
  expect(started!.status).toBe(200);
  expect(store.get(created.id).workConversationId).toBe(`task-${created.id}`);
  const bad = await routes.handle(new Request("http://local/api/tasks", {
    method: "POST", headers: { "content-type": "application/json" }, body: '{"action":"invalid"}',
  }), "/api/tasks", actor);
  expect(bad!.status).toBe(400);
  expect(await bad!.json()).toEqual({ error: "Invalid task request." });
});
