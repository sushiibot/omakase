import { ulid } from "../../../workspace/ulid.ts";
import { taskAction } from "../../../orchestration/taskContracts.ts";
import type { WorkspaceLink } from "../../../orchestration/workspace/link.ts";
import type { SurfaceActor } from "../../../orchestration/workspace/surface.ts";
import type { ConversationOperations } from "./conversationService.ts";

export interface TaskConversations {
  taskNeedsInput(id: string): boolean;
  ensureTask(id: string, title: string, brief: string): Promise<void>;
  conversation(id: string): ConversationOperations;
}

/** Serializes task mutations and coordinates persistent task conversations. */
export class TaskService {
  constructor(
    private readonly link: Pick<WorkspaceLink, "tasksManage" | "runsStop">,
    private readonly threads: TaskConversations,
  ) {}
  private mutation: Promise<unknown> = Promise.resolve();
  /** `origin` "agent" marks a task the agent starts, so its opening message never counts as the owner's. */
  async action(
    raw: unknown,
    actor: SurfaceActor,
    conversationId = "main",
    origin: "owner" | "agent" = "owner",
  ) {
    const request = taskAction.parse(raw);
    if (request.action === "list" || request.action === "get") {
      const result = await this.link.tasksManage(request);
      return {
        tasks: result.tasks.map((task) =>
          task.workConversationId &&
          this.threads.taskNeedsInput(task.workConversationId) &&
          task.status !== "done" &&
          task.status !== "cancelled"
            ? { ...task, status: "needs-you" as const }
            : task,
        ),
      };
    }
    const run = async () => {
      if (
        request.action !== "start" &&
        request.action !== "stop" &&
        request.action !== "prepare"
      ) {
        return this.link.tasksManage(
          request.action === "create"
            ? {
                ...request,
                conversationId: request.conversationId ?? conversationId,
              }
            : request,
        );
      }
      let task = (
        await this.link.tasksManage({ action: "get", id: request.id })
      ).tasks[0]!;
      if (
        request.action === "prepare" &&
        (task.status === "done" || task.status === "cancelled")
      )
        throw new Error("This task is already complete or cancelled.");
      if (request.action === "stop") {
        const all = (await this.link.tasksManage({ action: "list" })).tasks;
        const included = new Set([task.id]);
        for (let size = 0; size !== included.size;) {
          size = included.size;
          for (const child of all)
            if (child.parentTaskId && included.has(child.parentTaskId))
              included.add(child.id);
        }
        const runIds = new Set(
          all.filter((t) => included.has(t.id)).flatMap((t) => t.runIds),
        );
        for (const id of runIds) await this.link.runsStop(id);
        for (const child of all.filter((t) => included.has(t.id))) {
          if (child.workConversationId) {
            const res = await this.threads.conversation(child.workConversationId).stop({}, actor);
            if (res.kind !== "accepted")
              throw new Error(
                "Could not stop this task. Reload its activity and try again.",
              );
          }
          const fresh = (
            await this.link.tasksManage({ action: "get", id: child.id })
          ).tasks[0]!;
          if (fresh.status !== "done" && fresh.status !== "cancelled")
            await this.link.tasksManage({
              action: "update",
              id: fresh.id,
              revision: fresh.revision,
              patch: { status: "todo" },
            });
        }
        return this.link.tasksManage({ action: "get", id: task.id });
      }
      const id = task.workConversationId ?? `task-${task.id}`;
      await this.threads.ensureTask(
        id,
        task.title.slice(0, 120),
        `Task ${task.id}: ${task.title}\n${task.brief}\nChecklist: ${JSON.stringify(task.checklist)}\nExisting runs: ${task.runIds.join(", ")}\nWork on this persistent assignment. Use task_manage to keep its checklist and status current. Resume a finished delegated agent with delegate continue when appropriate; do not duplicate an active run.`,
      );
      if (!task.workConversationId)
        task = (
          await this.link.tasksManage({
            action: "bind",
            id: task.id,
            conversationId: id,
          })
        ).tasks[0]!;
      // Scheduling prepares both bot and workspace routing without starting an agent turn.
      if (request.action === "prepare") return { tasks: [task] };
      const res = await this.threads.conversation(id).submit({
        clientId: ulid(),
        text: request.text ?? `Work on task ${task.id}: ${task.title}. ${task.brief}`,
      }, actor, origin);
      if (res.kind !== "accepted")
        throw new Error(
          "The task message could not be accepted. Your task is saved; try again.",
        );
      return {
        tasks: [
          (await this.link.tasksManage({ action: "get", id: task.id }))
            .tasks[0]!,
        ],
      };
    };
    const next = this.mutation.then(run, run);
    this.mutation = next.catch(() => {});
    return next;
  }
}
