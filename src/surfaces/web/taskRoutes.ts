import { ulid } from "../../workspace/ulid.ts";
import { taskAction } from "../../orchestration/taskContracts.ts";
import type { WorkspaceLink } from "../../orchestration/workspace/link.ts";
import type { SurfaceActor } from "../../orchestration/workspace/surface.ts";
import { RpcErrorReply } from "../../orchestration/transport/server.ts";
import type { WebThreads } from "./threadRoutes.ts";
import { json, readJson } from "./http.ts";
import { unavailableFor } from "./readRoutes.ts";

export class TaskRoutes {
  constructor(
    private readonly link: Pick<WorkspaceLink, "tasksManage" | "runsStop">,
    private readonly threads: WebThreads,
  ) {}
  private mutation: Promise<unknown> = Promise.resolve();
  async action(raw: unknown, actor: SurfaceActor, conversationId = "main") {
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
      if (request.action !== "start" && request.action !== "stop" && request.action !== "prepare") {
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
      if (request.action === "prepare" && (task.status === "done" || task.status === "cancelled"))
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
            const res = await this.threads
              .channel(child.workConversationId)
              .routes.handle(
                new Request("http://task.local/api/chat/stop", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: "{}",
                }),
                "/api/chat/stop",
                actor,
              );
            if (res && !res.ok)
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
      const res = await this.threads
        .channel(id)
        .routes.handle(
          new Request("http://task.local/api/chat/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientId: ulid(),
              text:
                request.text ??
                `Work on task ${task.id}: ${task.title}. ${task.brief}`,
            }),
          }),
          "/api/chat/messages",
          actor,
        );
      if (!res?.ok)
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
  async handle(
    req: Request,
    path: string,
    actor: SurfaceActor,
    server?: { timeout(req: Request, seconds: number): void },
  ): Promise<Response | null> {
    if (path !== "/api/tasks" && !path.startsWith("/api/tasks/")) return null;
    try {
      if (path === "/api/tasks") {
        if (req.method === "GET") {
          const conversationId =
            new URL(req.url).searchParams.get("conversationId") ?? undefined;
          return json(
            await this.action(
              { action: "list", ...(conversationId ? { conversationId } : {}) },
              actor,
            ),
          );
        }
        if (req.method !== "POST")
          return json({ error: "method not allowed" }, 405);
        const raw = await readJson(req, 64000);
        if (raw instanceof Response) return raw;
        return json(await this.action(raw, actor));
      }
      const match = /^\/api\/tasks\/([a-z0-9-]{1,80})\/chat\/(.+)$/.exec(path);
      if (!match) return json({ error: "not found" }, 404);
      const task = (
        await this.link.tasksManage({ action: "get", id: match[1]! })
      ).tasks[0]!;
      if (!task.workConversationId)
        return json(
          { error: "Start this task before opening its conversation." },
          409,
        );
      return await this.threads.handle(
        req,
        `/api/threads/${task.workConversationId}/chat/${match[2]}`,
        actor,
        server,
      );
    } catch (err) {
      if (
        err instanceof RpcErrorReply &&
        [-32040, -32041, -32042].includes(err.code)
      )
        return json({ error: err.message }, err.code === -32040 ? 404 : 409);
      const unavailable = unavailableFor(err);
      if (unavailable) return json(unavailable.body, unavailable.status);
      if (err instanceof Error && err.name === "ZodError")
        return json({ error: "Invalid task request." }, 400);
      return json(
        { error: "Could not update this task. Reload and try again." },
        409,
      );
    }
  }
}

export const taskManifest = {
  name: "task_manage",
  description:
    "Manage the owner's persistent tasks and checklists. Actions: list, get, create, update, prepare, start, stop. create saves a to-do without executing it. prepare opens the task's work conversation without starting a run. start starts or prompts the task's own Sushii conversation; it can delegate coding or research. update requires the latest revision from get/list. Use patch.checklist items {id,title,done}. Mark done only when the outcome is verified. Never treat a stopped run as a cancelled task. Tasks and their runs are separate; use run IDs for delegate continue.",
  approval: "none" as const,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["list", "get", "create", "update", "prepare", "start", "stop"],
      },
      id: { type: "string" },
      title: { type: "string" },
      brief: { type: "string" },
      text: { type: "string" },
      conversationId: { type: "string" },
      parentTaskId: { type: "string" },
      revision: { type: "integer" },
      patch: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          brief: { type: "string" },
          status: {
            type: "string",
            enum: ["todo", "in-progress", "needs-you", "done", "cancelled"],
          },
          checklist: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "title", "done"],
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                done: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  },
};
