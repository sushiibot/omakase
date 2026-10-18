import { BrokerError } from "../../integrations/broker.ts";
import { IntegrationError, Integrations } from "../../integrations/service.ts";
import { forbidden, isJson, isSameOrigin, json, readJson } from "./http.ts";

/** Called only after the gateway's peer and owner authentication checks. No secret read endpoint. */
export class IntegrationRoutes {
  constructor(private readonly integrations: Integrations) {}
  async handle(req: Request, path: string): Promise<Response | null> {
    if (path !== "/api/integrations" && !path.startsWith("/api/integrations/")) return null;
    if (!isSameOrigin(req)) return forbidden();
    try {
      if (path === "/api/integrations" && req.method === "GET") return json({ integrations: this.integrations.list() });
      const id = path.slice("/api/integrations/".length);
      if (!/^[a-z][a-z0-9_]{0,47}$/.test(id) || !this.integrations.list().some(i => i.id === id)) return json({ error: "not found" }, 404);
      if (req.method === "DELETE") return json({ integrations: this.integrations.remove(id) });
      if (req.method !== "PUT") return json({ error: "method not allowed" }, 405);
      if (!isJson(req)) return json({ error: "content-type must be application/json" }, 415);
      const body = await readJson(req, id === "google_maps" ? 1024 : 8192);
      if (body instanceof Response) return body;
      return json({ integrations: await this.integrations.save(id, body) });
    } catch (err) {
      // Storage and provider exceptions must never reach the general error logger.
      return json({ error: (err instanceof IntegrationError || err instanceof BrokerError) ? err.message : "Could not update integration storage. Try again." }, (err instanceof IntegrationError || err instanceof BrokerError) ? 400 : 500);
    }
  }
}
