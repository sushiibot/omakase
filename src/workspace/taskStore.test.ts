import { afterEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./taskStore.ts";
import { maintainTasks, staleEntries } from "./tasks.ts";
import { DEFAULT_TASK_RULES } from "./config.ts";
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function env() {
  const home = mkdtempSync(join(tmpdir(), "task-store-"));
  dirs.push(home);
  const state = join(home, "state");
  mkdirSync(state);
  return { home, state };
}
test("legacy tasks and project checklists import once with original files preserved", () => {
  const { home, state } = env();
  mkdirSync(join(home, "tasks"));
  const text =
    "# TASKS.md\n## Quick\n- [ ] Book dentist (id: t-dentist) updated:2026-01-01\n## Projects\n- Login fix → tasks/login.md\n";
  writeFileSync(join(home, "TASKS.md"), text);
  writeFileSync(
    join(home, "tasks/login.md"),
    "# Login\nstatus: active\n- [x] Reproduce\n- [ ] Verify\n",
  );
  const store = new TaskStore(state, home);
  expect(store.list()).toHaveLength(2);
  expect(store.get("t-dentist").title).toBe("Book dentist");
  const project = store.list().find((t) => t.legacyKey === "login")!;
  expect(project.checklist.map((c) => c.done)).toEqual([true, false]);
  expect(readFileSync(join(home, "TASKS.md.before-tasks-v2"), "utf8")).toBe(
    text,
  );
  expect(readFileSync(join(home, "tasks/login.md"), "utf8")).toContain(
    "- [ ] Verify",
  );
  expect(new TaskStore(state, home).list().map((t) => t.id)).toEqual(
    store.list().map((t) => t.id),
  );
  expect(
    maintainTasks(home, DEFAULT_TASK_RULES, new Date("2030-01-01")).changed,
  ).toBe(false);
  expect(
    staleEntries(home, DEFAULT_TASK_RULES, new Date("2030-01-01")),
  ).toEqual([]);
});
test("revision checks preserve another writer updates, and reads cannot mutate records", () => {
  const { home, state } = env(),
    store = new TaskStore(state, home);
  const task = store.manage({ action: "create", title: "Fix login" }).tasks[0]!;
  store.manage({
    action: "update",
    id: task.id,
    revision: task.revision,
    patch: { checklist: [{ id: "c-test", title: "Test expiry", done: false }] },
  });
  expect(() =>
    store.manage({
      action: "update",
      id: task.id,
      revision: task.revision,
      patch: { title: "Old edit" },
    }),
  ).toThrow("changed");
  const read = store.get(task.id);
  read.title = "Mutated";
  expect(store.get(task.id).title).toBe("Fix login");
  expect(new TaskStore(state, home).get(task.id).checklist).toHaveLength(1);
});
test("completion and execution are distinct, and follow-ups retain task identity", () => {
  const { home, state } = env(),
    store = new TaskStore(state, home),
    task = store.manage({
      action: "create",
      title: "Fix login",
      conversationId: "topic-login",
    }).tasks[0]!;
  store.manage({
    action: "bind",
    id: task.id,
    conversationId: `task-${task.id}`,
  });
  store.attachRun(task.id, "run-one", "coder");
  store.settleRun("run-one", "done", "Tests passed");
  expect(store.get(task.id).status).toBe("needs-you");
  store.attachRun(task.id, "run-two", "coder");
  expect(store.forRun("run-one")?.id).toBe(task.id);
  expect(store.get(task.id).runIds).toEqual(["run-one", "run-two"]);
  const latest = store.get(task.id);
  store.manage({
    action: "update",
    id: task.id,
    revision: latest.revision,
    patch: { status: "done" },
  });
  store.settleRun("run-two", "done");
  expect(store.get(task.id).status).toBe("done");
  expect(store.list("main")).toEqual([]);
  expect(store.list("topic-login")).toHaveLength(1);
});
test("corrupt persisted state never silently replaces tasks", () => {
  const { home, state } = env();
  writeFileSync(join(state, "tasks-v2.json"), "{broken");
  expect(() => new TaskStore(state, home)).toThrow("refusing");
  expect(readFileSync(join(state, "tasks-v2.json"), "utf8")).toBe("{broken");
});

test("one finished attempt does not hide another active attempt", () => {
  const { home, state } = env();
  const store = new TaskStore(state, home);
  const task = store.manage({ action: "create", title: "Check login" }).tasks[0]!;
  const active = new Set(["run-a", "run-b"]);
  store.setRunActivity(id => active.has(id));
  store.attachRun(task.id, "run-a", "coder");
  store.attachRun(task.id, "run-b", "reviewer");
  active.delete("run-a"); store.settleRun("run-a", "done", "Fix ready");
  expect(store.get(task.id).status).toBe("in-progress");
  active.delete("run-b"); store.settleRun("run-b", "done", "Review ready");
  expect(store.get(task.id).status).toBe("needs-you");
});
