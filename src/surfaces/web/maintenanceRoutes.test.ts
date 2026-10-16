import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createReadRoutes, type ReadRouteLink } from "./readRoutes.ts";
const result = { view: { responsibility: { title: "Keep upcoming plans accurate", enabled: true, lastReadAt: null, lastReviewAt: null, lastError: null }, proposals: [] } };
test("maintenance routes validate owner decisions and do not accept arbitrary tool arguments", async () => {
  const db = new Database(":memory:"); const calls: unknown[] = [];
  const deps = { db, link: { isConnected: () => true } as ReadRouteLink, workspaceEnabled: true,
    maintenance: { maintenance: async (request: unknown) => { calls.push(request); return result; } } };
  const routes = createReadRoutes(deps);
  const req = (body?: unknown, method = body ? "POST" : "GET") => new Request("https://agent.example/api/maintenance", { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const list = await routes.handle(req(), "/api/maintenance"); expect(await list?.json()).toEqual(result); expect(list?.headers.get("Cache-Control")).toContain("no-store");
  const id = "00000000-0000-4000-8000-000000000001";
  expect((await routes.handle(req({ action: "approve", id, revision: 1 }), "/api/maintenance"))?.status).toBe(200);
  expect((await routes.handle(req({ action: "approve", id, revision: 1, tool: "send_email" }), "/api/maintenance"))?.status).toBe(400);
  expect((await routes.handle(req({ action: "approve", id }), "/api/maintenance"))?.status).toBe(400);
  expect((await routes.handle(req(undefined, "DELETE"), "/api/maintenance"))?.status).toBe(405);
  expect(calls).toEqual([{ action: "list" }, { action: "approve", id, revision: 1 }]);
  const offline = createReadRoutes({ ...deps, workspaceEnabled: false });
  expect((await offline.handle(req(), "/api/maintenance"))?.status).toBe(503); db.close();
});
