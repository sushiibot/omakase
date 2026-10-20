import { RpcErrorReply } from "../../orchestration/transport/server.ts";
import { blockRequest, messageKey, type BlockRequest, type BlocksResult } from "../../orchestration/blockContracts.ts";
import { isJson, json, readJson } from "./http.ts";
import { unavailableFor } from "./readRoutes.ts";

/** The live-block calls the routes need: the workspace link's blocks/manage. */
export interface BlockPort {
  blocksManage(request: BlockRequest): Promise<BlocksResult>;
}

/**
 * /api/blocks: the owner reads and changes live blocks (checklists, recipes, timers, reply blocks).
 * GET ?keys=<outbox key>,... lists a set of replies' blocks; POST { id, ops } applies changes and
 * answers the new revision. The workspace announces every change, so other devices update too.
 */
export class BlockRoutes {
  constructor(private readonly link: BlockPort) {}

  async handle(req: Request, path: string): Promise<Response | null> {
    if (path !== "/api/blocks") return null;
    try {
      if (req.method === "GET") {
        const keys = (new URL(req.url).searchParams.get("keys") ?? "").split(",").filter(Boolean);
        if (!keys.length || keys.length > 50 || !keys.every((k) => messageKey.safeParse(k).success)) {
          return json({ error: "Name 1–50 reply keys." }, 400);
        }
        return json(await this.link.blocksManage({ action: "list", messageKeys: keys }));
      }
      if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (!isJson(req)) return json({ error: "Send JSON." }, 415);
      const raw = await readJson(req, 16_000);
      if (raw instanceof Response) return raw;
      const request = blockRequest.parse({ ...(raw && typeof raw === "object" ? raw : {}), action: "apply" });
      return json(await this.link.blocksManage(request));
    } catch (err) {
      if (err instanceof RpcErrorReply && err.code === -32040) return json({ error: err.message }, 404);
      if (err instanceof RpcErrorReply && err.code === -32042) return json({ error: err.message }, 409);
      const unavailable = unavailableFor(err);
      if (unavailable) return json(unavailable.body, unavailable.status);
      if (err instanceof Error && err.name === "ZodError") return json({ error: "Invalid block change." }, 400);
      return json({ error: "Could not update this block. Reload and try again." }, 409);
    }
  }
}
