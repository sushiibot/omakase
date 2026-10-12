import { z } from "zod";
import type { MachineControl } from "../../orchestration/machines/control.ts";
import type { WorkspaceLink } from "../../orchestration/workspace/link.ts";
import { json, readJson } from "./http.ts";
export class MachineRoutes {
  constructor(
    private control: MachineControl,
    private link: Pick<WorkspaceLink, "tasksManage">,
  ) {}
  async handle(req: Request, path: string): Promise<Response | null> {
    if (path !== "/api/machines" && !path.startsWith("/api/machines/"))
      return null;
    try {
      if (path === "/api/machines" && req.method === "GET")
        return json({ machines: this.control.list() });
      if (path === "/api/machines/files" && req.method === "POST") {
        const raw = await readJson(req, 8000);
        if (raw instanceof Response) return raw;
        return json(await this.control.files(raw));
      }
      const match =
        /^\/api\/machines\/tasks\/([a-z0-9-]{1,80})(\/answer)?$/.exec(path);
      if (!match) return json({ error: "Not found." }, 404);
      const task = (
        await this.link.tasksManage({ action: "get", id: match[1]! })
      ).tasks[0]!;
      if (!match[2] && req.method === "GET") {
        const session = await this.control.session(task);
        await this.control.sync(task, session);
        return json({ session });
      }
      if (match[2] && req.method === "POST") {
        const raw = await readJson(req, 1000);
        if (raw instanceof Response) return raw;
        const p = z
          .object({
            requestId: z.union([z.string().max(200), z.number()]),
            decision: z.enum(["accept", "decline"]),
          })
          .strict()
          .parse(raw);
        return json({
          session: await this.control.answer(task, p.requestId, p.decision),
        });
      }
      return json({ error: "Method not allowed." }, 405);
    } catch (err) {
      return json(
        {
          error: err instanceof Error ? err.message : "Machine request failed.",
        },
        err instanceof z.ZodError ? 400 : 409,
      );
    }
  }
}
