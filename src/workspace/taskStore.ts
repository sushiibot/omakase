import { join } from "node:path";
import { existsSync, readFileSync, copyFileSync, lstatSync } from "node:fs";
import { z } from "zod";
import {
  taskRecord,
  tasksParams,
  type TaskRecord,
  type TaskRequest,
  TASKS_MANAGE,
} from "../orchestration/taskContracts.ts";
import { writeFileAtomic } from "./files.ts";
import { parseTasksIndex, readTasks, TASKS_FILE } from "./tasks.ts";
import { RpcHandlerError } from "../orchestration/transport/client.ts";

/** Tasks once carried a remote-session link; coding agents are separate now, so the field is dropped on load. */
function withoutExecution(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || !("execution" in raw)) return raw;
  const { execution: _, ...rest } = raw as Record<string, unknown>;
  return rest;
}

export class TaskStore {
  private records: TaskRecord[];
  private readonly path: string;
  private isRunActive: (id: string) => boolean = () => false;
  setRunActivity(active: (id: string) => boolean) {
    this.isRunActive = active;
  }
  private leaseProjection: () => () => void = () => () => {};
  setProjectionLease(lease: () => () => void) {
    this.leaseProjection = lease;
  }
  constructor(
    stateDir: string,
    private readonly home: string,
  ) {
    this.path = join(stateDir, "tasks-v2.json");
    let saved: unknown = null;
    if (existsSync(this.path)) {
      const stat = lstatSync(this.path);
      if (!stat.isFile() || stat.size > 64 * 1024 * 1024)
        throw new Error("Invalid task store file.");
      try {
        saved = JSON.parse(readFileSync(this.path, "utf8"));
      } catch {
        throw new Error("Cannot read the task store; refusing to replace it.");
      }
    }
    if (saved === null && existsSync(this.path))
      throw new Error("Cannot read the task store; refusing to replace it.");
    this.records =
      saved === null
        ? this.importLegacy()
        : z
            .array(taskRecord)
            .max(2000)
            .parse(Array.isArray(saved) ? saved.map(withoutExecution) : saved);
    this.persist();
  }
  list(conversationId?: string): TaskRecord[] {
    return structuredClone(
      this.records.filter(
        (t) =>
          !conversationId ||
          t.sourceConversationId === conversationId ||
          t.workConversationId === conversationId,
      ),
    );
  }
  get(id: string): TaskRecord {
    const task = this.records.find((t) => t.id === id);
    if (!task) throw new RpcHandlerError("Task not found.", -32040);
    return structuredClone(task);
  }
  manage(request: TaskRequest): { tasks: TaskRecord[] } {
    if (request.action === "list")
      return { tasks: this.list(request.conversationId) };
    if (request.action === "get") return { tasks: [this.get(request.id)] };
    if (request.action === "create") {
      if (this.records.length >= 2000)
        throw new RpcHandlerError("The task store is full.", -32042);
      if (request.parentTaskId) this.get(request.parentTaskId);
      const at = new Date().toISOString();
      const task: TaskRecord = {
        id: `t-${crypto.randomUUID()}`,
        title: request.title,
        brief: request.brief ?? "",
        status: "todo",
        checklist: [],
        sourceConversationId: request.conversationId ?? "main",
        ...(request.parentTaskId ? { parentTaskId: request.parentTaskId } : {}),
        runIds: [],
        revision: 1,
        createdAt: at,
        updatedAt: at,
      };
      const previous = this.records;
      this.records = [...previous, task];
      try {
        this.persist();
      } catch (err) {
        this.records = previous;
        throw err;
      }
      return { tasks: [structuredClone(task)] };
    }
    const task = this.get(request.id);
    if (request.action === "update") {
      if (task.revision !== request.revision)
        throw new RpcHandlerError(
          "This task changed. Reload it before saving.",
          -32041,
        );
      if (
        request.patch.checklist &&
        new Set(request.patch.checklist.map((c) => c.id)).size !==
          request.patch.checklist.length
      )
        throw new RpcHandlerError("Checklist IDs must be unique.", -32602);
      Object.assign(task, request.patch);
    } else {
      if (
        task.workConversationId &&
        task.workConversationId !== request.conversationId
      )
        throw new RpcHandlerError(
          "This task already has a conversation.",
          -32041,
        );
      task.workConversationId = request.conversationId;
      task.agent ??= "Sushii";
    }
    return { tasks: [this.save(task)] };
  }
  attachRun(id: string, runId: string, agent: string) {
    const task = this.get(id);
    if (!task.runIds.includes(runId))
      task.runIds = [...task.runIds, runId].slice(-100);
    task.agent = agent;
    // Conversation follow-ups and late delegated runs must not reopen closed work.
    // Reopening is an explicit task update, independent of execution history.
    if (task.status !== "done" && task.status !== "cancelled")
      task.status = "in-progress";
    this.save(task);
  }
  settleRun(runId: string, status: string, result?: string) {
    for (const original of this.records.filter((t) =>
      t.runIds.includes(runId),
    )) {
      const task = this.get(original.id);
      if (task.status !== "done" && task.status !== "cancelled")
        task.status = task.runIds.some(
          (id) => id !== runId && this.isRunActive(id),
        )
          ? "in-progress"
          : status === "done"
            ? "needs-you"
            : "todo";
      task.result = result?.slice(0, 4000);
      this.save(task);
    }
  }
  /**
   * Drops run links `stray` rejects. A repaired task takes its result and last activity from its newest remaining
   * run, since stray runs overwrote both; it keeps its creation time when none remain.
   */
  detachRuns(
    stray: (runId: string) => boolean,
    run: (runId: string) => { endedAt?: string; startedAt: string; resultSummary?: string } | undefined,
  ) {
    let changed = false;
    this.records = this.records.map((original) => {
      const runIds = original.runIds.filter((id) => !stray(id));
      if (runIds.length === original.runIds.length) return original;
      changed = true;
      const last = runIds.map(run).filter((r) => r !== undefined).at(-1);
      const { result: _, ...rest } = original;
      return taskRecord.parse({
        ...rest,
        runIds,
        ...(last?.resultSummary ? { result: last.resultSummary.slice(0, 4000) } : {}),
        revision: original.revision + 1,
        updatedAt: last?.endedAt ?? last?.startedAt ?? original.createdAt,
      });
    });
    if (changed) this.persist();
  }
  forRun(runId: string) {
    return this.list().find((t) => t.runIds.includes(runId));
  }
  private save(task: TaskRecord): TaskRecord {
    task.revision++;
    task.updatedAt = new Date().toISOString();
    const next = taskRecord.parse(task);
    const previous = this.records;
    this.records = this.records.map((t) => (t.id === task.id ? next : t));
    try {
      this.persist();
    } catch (err) {
      this.records = previous;
      throw err;
    }
    return structuredClone(next);
  }
  private importLegacy(): TaskRecord[] {
    const text = readTasks(this.home);
    if (!text) return [];
    const source = join(this.home, TASKS_FILE);
    if (!existsSync(`${source}.before-tasks-v2`))
      copyFileSync(source, `${source}.before-tasks-v2`);
    const index = parseTasksIndex(text, this.home);
    const at = new Date().toISOString();
    const base = {
      sourceConversationId: "main",
      checklist: [],
      runIds: [],
      revision: 1,
      createdAt: at,
      updatedAt: at,
    };
    const quick = index.quick.map((q) => ({
      ...base,
      id: q.id ?? `t-${crypto.randomUUID()}`,
      title: q.title.slice(0, 200),
      brief: index.lines[q.line]!,
      status:
        q.state === "open" ? "todo" : q.state === "done" ? "done" : "cancelled",
      legacyKey: q.id,
    }));
    const projects = index.projects.map((p) => {
      let brief = "";
      try {
        brief = readFileSync(join(this.home, "tasks", `${p.slug}.md`), "utf8");
      } catch {
        /* Keep the index entry even if its detail is missing. */
      }
      const checklist = [...brief.matchAll(/^\s*- \[([ xX-])\] (.+)$/gm)]
        .slice(0, 100)
        .map((m) => ({
          id: `c-${crypto.randomUUID()}`,
          title: m[2]!.slice(0, 300),
          done: m[1] !== " ",
        }));
      return {
        ...base,
        id: `t-${crypto.randomUUID()}`,
        title: p.name.slice(0, 200),
        brief: brief.slice(0, 16000),
        checklist,
        status:
          p.status === "done"
            ? "done"
            : p.status === "dropped"
              ? "cancelled"
              : "todo",
        legacyKey: p.slug,
      };
    });
    const imported = z.array(taskRecord).parse([...quick, ...projects]);
    if (new Set(imported.map((t) => t.id)).size !== imported.length)
      throw new Error(
        "Duplicate legacy task IDs; task migration needs repair.",
      );
    return imported;
  }
  private persist() {
    writeFileAtomic(this.path, JSON.stringify(this.records, null, 2));
    const active = this.records.filter(
      (t) => t.status !== "done" && t.status !== "cancelled",
    );
    let release = () => {};
    try {
      release = this.leaseProjection();
      writeFileAtomic(
        join(this.home, TASKS_FILE),
        `# TASKS.md\n\n<!-- tasks-v2: generated; use task_manage to change tasks -->\nThis is a generated index. The task store is canonical. Use task_manage to read and update tasks; do not edit this file.\n\n## Quick\n${active.map((t) => `- [ ] ${t.title.replace(/\s+/g, " ")} (id: ${t.id}) status:${t.status} updated:${t.updatedAt.slice(0, 10)}`).join("\n")}\n`,
      );
    } catch (err) {
      console.error("Could not refresh the generated task index:", err);
    } finally {
      release();
    }
  }
  handlers(principalId: string) {
    return {
      [TASKS_MANAGE]: async (raw: unknown) => {
        const p = tasksParams.parse(raw);
        if (p.principalId !== principalId)
          throw new RpcHandlerError("principal mismatch", -32602);
        return this.manage(p.request);
      },
    };
  }
}
