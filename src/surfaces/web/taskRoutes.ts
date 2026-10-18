import type { SurfaceActor } from "../../orchestration/workspace/surface.ts";
import { RpcErrorReply } from "../../orchestration/transport/server.ts";
import type { WebThreads } from "./threadRoutes.ts";
import { json, readJson } from "./http.ts";
import type { TaskService } from "./application/taskService.ts";
import { unavailableFor } from "./readRoutes.ts";

export class TaskRoutes {
  constructor(
    private readonly service: TaskService,
    private readonly threads: WebThreads,
  ) {}
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
            await this.service.action(
              { action: "list", ...(conversationId ? { conversationId } : {}) },
              actor,
            ),
          );
        }
        if (req.method !== "POST")
          return json({ error: "method not allowed" }, 405);
        const raw = await readJson(req, 64000);
        if (raw instanceof Response) return raw;
        return json(await this.service.action(raw, actor));
      }
      const match = /^\/api\/tasks\/([a-z0-9-]{1,80})\/chat\/(.+)$/.exec(path);
      if (!match) return json({ error: "not found" }, 404);
      const task = (
        await this.service.action({ action: "get", id: match[1]! }, actor)
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

export { taskManifest } from "../../orchestration/taskManifest.ts";
