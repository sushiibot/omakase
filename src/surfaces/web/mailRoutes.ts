import { z } from "zod/v4";
import type { MailService } from "../../integrations/mail/service.ts";
import { IntegrationError } from "../../integrations/mail/types.ts";
import type { JsonState } from "../../db/jsonState.ts";
import { isJson, json, readJson } from "./http.ts";
export const TOOL_POLICY_KEY = "integrations:tool-policy";
export const isMailCallback = (path: string) => /^\/api\/mail\/oauth\/[a-z][a-z0-9-]*\/callback$/.test(path);
export class MailRoutes {
  constructor(private mail: MailService, private state: JsonState) {}
  async handle(req: Request, path: string): Promise<Response | null> {
    if (!path.startsWith("/api/mail/") && path !== "/api/mail" && path !== "/api/tool-policy") return null;
    if (isMailCallback(path) && req.method === "GET") {
      const url = new URL(req.url); const provider = path.split("/")[4]!;
      const state = url.searchParams.get("state");
      const cookie = req.headers.get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith("mail_oauth="))?.slice("mail_oauth=".length);
      let outcome = "failed";
      try {
        if (!state || cookie !== state || !url.searchParams.get("code")) throw new IntegrationError("Invalid sign-in response.");
        await this.mail.finish(provider, state, url.searchParams.get("code")!); outcome = "connected";
      } catch { /* Never put provider errors, codes or credentials into URLs or logs. */ }
      return new Response(null, { status: 303, headers: { Location: `/settings/mail?connection=${outcome}`, "Cache-Control": "no-store", "Set-Cookie": `mail_oauth=; Path=/api/mail/oauth/; HttpOnly; SameSite=Lax; Max-Age=0` } });
    }
    try {
      if (path === "/api/mail" && req.method === "GET") return json({ accounts: this.mail.list(), providers: this.mail.catalog() });
      if (path === "/api/tool-policy" && req.method === "GET") return json({ rules: this.state.get<string>(TOOL_POLICY_KEY) ?? "" });
      if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
      if (!isJson(req)) return json({ error: "Use application/json." }, 415);
      const body = await readJson(req, 16_384); if (body instanceof Response) return body;
      if (path === "/api/tool-policy") {
        const { rules } = z.object({ rules: z.string().trim().max(4000) }).strict().parse(body);
        this.state.set(TOOL_POLICY_KEY, rules); return json({ rules });
      }
      const connect = /^\/api\/mail\/providers\/([a-z][a-z0-9-]*)\/(begin|token)$/.exec(path);
      if (connect) {
        if (connect[2] === "token") return json({ account: await this.mail.connectToken(connect[1]!, body) });
        const start = this.mail.begin(connect[1]!, body); const response = json({ url: start.url });
        response.headers.set("Set-Cookie", `mail_oauth=${start.state}; Path=/api/mail/oauth/; HttpOnly; SameSite=Lax; Max-Age=600${!["localhost", "127.0.0.1"].includes(new URL(req.url).hostname) ? "; Secure" : ""}`);
        return response;
      }
      const account = /^\/api\/mail\/accounts\/([a-f0-9-]{36})\/(rename|remove)$/.exec(path);
      if (account) return account[2] === "remove" ? json(await this.mail.remove(account[1]!)) : json({ account: this.mail.rename(account[1]!, body) });
      return json({ error: "Not found." }, 404);
    } catch (err) {
      return json({ error: err instanceof IntegrationError ? err.message : err instanceof z.ZodError ? "Check the account fields." : "The account operation failed. Try again." }, err instanceof IntegrationError ? err.status : 422);
    }
  }
}
