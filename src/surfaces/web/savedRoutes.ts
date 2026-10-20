import { RpcErrorReply } from "../../orchestration/transport/server.ts";
import { savedId, savedKind, savedRequest, type SavedRequest, type SavedResult } from "../../orchestration/savedContracts.ts";
import { TOPIC_ID_RE } from "../../orchestration/contracts.ts";
import { isJson, json, readJson } from "./http.ts";
import { unavailableFor } from "./readRoutes.ts";

/** The saved-item calls the routes need: the workspace link's saved/manage. */
export interface SavedPort {
  savedManage(request: SavedRequest): Promise<SavedResult>;
}

const STATUSES = new Set(["active", "done", "all"]);

/**
 * /api/saved: the owner's saved items (documents, checklists, recipes, timers).
 * GET lists them (?conversation=&status=active|done|all&kind=&pinned=1|0&q=) or reads one (?id=);
 * POST { action: pin|unpin|archive|restore|opened, id } changes one and answers it as it now stands.
 * The workspace announces each change, so other devices refetch.
 */
export class SavedRoutes {
  constructor(private readonly link: SavedPort) {}

  async handle(req: Request, path: string): Promise<Response | null> {
    if (path !== "/api/saved") return null;
    try {
      if (req.method === "GET") {
        const q = new URL(req.url).searchParams;
        const id = q.get("id");
        if (id !== null) {
          if (!savedId.safeParse(id).success) return json({ error: "Invalid item id." }, 400);
          return json(await this.link.savedManage({ action: "get", id }));
        }
        const conversation = q.get("conversation");
        const status = q.get("status") ?? "active";
        const kind = q.get("kind");
        const pinned = q.get("pinned");
        const query = q.get("q") ?? "";
        if (
          (conversation !== null && !TOPIC_ID_RE.test(conversation)) ||
          !STATUSES.has(status) ||
          (kind !== null && !savedKind.safeParse(kind).success) ||
          (pinned !== null && pinned !== "1" && pinned !== "0") ||
          query.length > 200
        ) {
          return json({ error: "Invalid filter." }, 400);
        }
        return json(await this.link.savedManage({
          action: "list",
          status: status as "active" | "done" | "all",
          ...(conversation ? { conversationId: conversation } : {}),
          ...(kind ? { kind: kind as never } : {}),
          ...(pinned !== null ? { pinned: pinned === "1" } : {}),
          ...(query.trim() ? { query: query.trim() } : {}),
        }));
      }
      if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (!isJson(req)) return json({ error: "Send JSON." }, 415);
      const raw = await readJson(req, 4_000);
      if (raw instanceof Response) return raw;
      const request = savedRequest.parse(raw);
      // Reads go through GET; a POST only ever changes an item.
      if (request.action === "list" || request.action === "get") return json({ error: "Invalid action." }, 400);
      return json(await this.link.savedManage(request));
    } catch (err) {
      if (err instanceof RpcErrorReply && err.code === -32040) return json({ error: err.message }, 404);
      const unavailable = unavailableFor(err);
      if (unavailable) return json(unavailable.body, unavailable.status);
      if (err instanceof Error && err.name === "ZodError") return json({ error: "Invalid request." }, 400);
      return req.method === "GET"
        ? json({ error: "Could not load saved items." }, 502)
        : json({ error: "Could not update this item. Reload and try again." }, 409);
    }
  }
}
