import { z } from "zod/v4";
import { Accounts, AccountError } from "../../accounts/service.ts";
import { isJson, json, readJson } from "./http.ts";
const reveal = z
  .object({
    version: z.number().int().positive().optional(),
    purpose: z.enum(["reveal", "copy"]),
  })
  .strict();
const archive = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();
export class AccountRoutes {
  constructor(private readonly accounts: Accounts) {}
  async handle(req: Request, path: string): Promise<Response | null> {
    if (path !== "/api/accounts" && !path.startsWith("/api/accounts/"))
      return null;
    try {
      if (path === "/api/accounts")
        return req.method === "GET"
          ? json({ accounts: this.accounts.list() })
          : json({ error: "Method not allowed." }, 405);
      const match = /^\/api\/accounts\/([^/]+)\/(audit|reveal|archive)$/.exec(
        path,
      );
      if (!match || !z.string().uuid().safeParse(match[1]).success)
        return json({ error: "Account not found." }, 404);
      const id = match[1]!;
      const action = match[2]!;
      if (action === "audit")
        return req.method === "GET"
          ? json({ events: this.accounts.audit(id) })
          : json({ error: "Method not allowed." }, 405);
      if (req.method !== "POST")
        return json({ error: "Method not allowed." }, 405);
      if (!isJson(req)) return json({ error: "Send a JSON body." }, 415);
      const raw = await readJson(req);
      if (raw instanceof Response) return raw;
      if (action === "reveal") {
        const p = reveal.safeParse(raw);
        if (!p.success) throw new AccountError(422);
        return json(this.accounts.reveal(id, p.data.version, p.data.purpose));
      }
      const p = archive.safeParse(raw);
      if (!p.success) throw new AccountError(422);
      return json(
        this.accounts.action(
          {
            action: "archive",
            accountId: id,
            expectedVersion: p.data.expectedVersion,
          },
          "owner",
        ),
      );
    } catch (error) {
      return json(
        { error: "Account operation could not be completed." },
        error instanceof AccountError ? error.status : 503,
      );
    }
  }
}
