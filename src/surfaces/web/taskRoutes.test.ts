import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../../workspace/taskStore.ts";
import { CLIENT_ID_RE } from "./events.ts";
import { TaskRoutes } from "./taskRoutes.ts";
import type { WebThreads } from "./threadRoutes.ts";
import type { TaskRequest } from "../../orchestration/taskContracts.ts";
import { mintWebActor } from "./actor.ts";
import { agentPosted } from "./chatRoutes.ts";
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
    channel(id: string) {
      if (!channels.has(id)) throw new Error("No channel");
      return {
        routes: {
          async handle(req: Request, path: string) {
            sent.push({ id, path, body: await req.json() });
            return Response.json({}, { status: 202 });
          },
        },
      };
    },
  } as unknown as WebThreads;
  const routes = new TaskRoutes(
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
  return { routes, store, actor, sent, stopped, channels };
}
test("manual create stays a to-do; repeated start and prompts use one isolated task channel", async () => {
  const { routes, store, actor, sent, channels } = setup();
  const task = (
    await routes.action(
      { action: "create", title: "Renew passport" },
      actor,
      "trip",
    )
  ).tasks[0]!;
  expect(task.status).toBe("todo");
  expect(task.sourceConversationId).toBe("trip");
  expect(sent).toHaveLength(0);
  await Promise.all([
    routes.action(
      { action: "start", id: task.id, text: "Check requirements" },
      actor,
    ),
    routes.action(
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
  const { routes, store, actor, sent, stopped } = setup();
  let task = (
    await routes.action({ action: "create", title: "Fix login" }, actor)
  ).tasks[0]!;
  await routes.action({ action: "start", id: task.id }, actor);
  task = store.get(task.id);
  store.manage({
    action: "update",
    id: task.id,
    revision: task.revision,
    patch: { checklist: [{ id: "test", title: "Verify expiry", done: false }] },
  });
  store.attachRun(task.id, "run-1", "coder");
  const result = await routes.action({ action: "stop", id: task.id }, actor);
  expect(stopped).toEqual(["run-1"]);
  expect(sent.at(-1)?.path).toBe("/api/chat/stop");
  expect(result.tasks[0]!.status).toBe("todo");
  expect(result.tasks[0]!.checklist).toHaveLength(1);
});

test("prepare creates one task conversation without starting work and refuses completed tasks", async () => {
  const { routes, store, actor, sent, channels } = setup();
  const task = (await routes.action({ action: "create", title: "Check delivery" }, actor)).tasks[0]!;
  await routes.action({ action: "prepare", id: task.id }, actor);
  await routes.action({ action: "prepare", id: task.id }, actor);
  const prepared = store.get(task.id);
  expect(prepared.workConversationId).toBe(`task-${task.id}`);
  expect(prepared.status).toBe("todo");
  expect(prepared.runIds).toEqual([]);
  expect(channels.size).toBe(1);
  expect(sent).toEqual([]);
  store.manage({ action: "update", id: task.id, revision: prepared.revision, patch: { status: "done" } });
  await expect(routes.action({ action: "prepare", id: task.id }, actor)).rejects.toThrow("already complete");
});

test("stopping a parent also stops child runs and task conversations", async () => {
  const { routes, store, actor, sent, stopped } = setup();
  const parent = (await routes.action({ action: "create", title: "Ship login" }, actor)).tasks[0]!;
  const child = (await routes.action({ action: "create", title: "Test login", parentTaskId: parent.id }, actor)).tasks[0]!;
  await routes.action({ action: "start", id: parent.id }, actor);
  await routes.action({ action: "start", id: child.id }, actor);
  store.attachRun(parent.id, "parent-run", "Sushii");
  store.attachRun(child.id, "child-run", "coder");
  await routes.action({ action: "stop", id: parent.id }, actor);
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
    channel(id: string) {
      return {
        routes: {
          async handle(req: Request) {
            if (!agentPosted.has(req)) ownerAt.set(id, ++now);
            return Response.json({}, { status: 202 });
          },
        },
      };
    },
  } as unknown as WebThreads;
  const routes = new TaskRoutes({ tasksManage: async (r: TaskRequest) => store.manage(r), runsStop: async () => ({ stopped: true }) }, threads);
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
  const task = (await routes.action({ action: "create", title: "Fix login" }, actor)).tasks[0]!;
  const conversation = `task-${task.id}`;
  state.set(`agent-loop:${conversation}`, { cycles: MAX_AUTO_CYCLES, since: 0 });
  expect(() => events.guard(conversation)).toThrow("paused");
  await routes.action({ action: "start", id: task.id, text: "keep going" }, actor, conversation, "agent");
  now += 10;
  expect(() => events.guard(conversation)).toThrow("paused");
  await routes.action({ action: "start", id: task.id, text: "go on" }, actor, conversation, "owner");
  now += 10;
  expect(() => events.guard(conversation)).not.toThrow();
});
