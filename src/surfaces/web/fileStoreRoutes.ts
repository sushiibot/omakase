import { z } from "zod";
import {
  FileStoreError,
  type FileStores,
} from "../../orchestration/workspace/fileStores/service.ts";
import { json, readJson } from "./http.ts";
export class FileStoreRoutes {
  constructor(private stores: FileStores) {}
  async handle(req: Request, path: string): Promise<Response | null> {
    if (path !== "/api/file-stores" && !path.startsWith("/api/file-stores/"))
      return null;
    try {
      if (path === "/api/file-stores") {
        if (req.method === "GET") return json({ stores: this.stores.list() });
        if (req.method === "POST") {
          const raw = await readJson(req, 32 * 1024);
          return raw instanceof Response
            ? raw
            : json({ store: this.stores.save(raw) });
        }
      }
      const match = /^\/api\/file-stores\/([a-f0-9-]{36})\/(test|remove)$/.exec(
        path,
      );
      if (match && req.method === "POST") {
        if (match[2] === "test")
          return json(await this.stores.check(match[1]!));
        const raw = await readJson(req);
        if (raw instanceof Response) return raw;
        const { revision } = z
          .object({ revision: z.number().int().positive() })
          .strict()
          .parse(raw);
        return json(this.stores.remove(match[1]!, revision));
      }
      return json({ error: "Not found." }, 404);
    } catch (error) {
      return json(
        {
          fields:
            error instanceof z.ZodError
              ? error.flatten().fieldErrors
              : error instanceof FileStoreError && error.field
                ? { [error.field]: [error.message] }
                : undefined,
          error:
            error instanceof FileStoreError
              ? error.message
              : error instanceof z.ZodError
                ? "Check the connection fields."
                : "Could not process the file-store request.",
        },
        error instanceof FileStoreError ? error.status : 422,
      );
    }
  }
}
