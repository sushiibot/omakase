import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createReadRoutes, type ReadRouteLink } from "./readRoutes.ts";

test("artifact reads forward search, reject invalid IDs and methods, and report offline", async () => {
  const db = new Database(":memory:");
  const calls: unknown[] = [];
  const deps = { db, link: { isConnected: () => true } as ReadRouteLink, workspaceEnabled: true,
    artifacts: { artifactsRead: async (id?: string, query?: string) => { calls.push({ id, query }); return id ? null : { artifacts: [], truncated: false }; } } };
  const routes = createReadRoutes(deps);
  const request = (path: string, method = "GET") => new Request(`http://localhost${path}`, { method });
  const list = await routes.handle(request('/api/artifacts?q=budget'), '/api/artifacts');
  expect(await list?.json()).toEqual({ artifacts: [], truncated: false });
  expect(calls).toEqual([{ id: undefined, query: 'budget' }]);
  expect(list?.headers.get('Cache-Control')).toContain('no-store');
  expect((await routes.handle(request('/api/artifacts', 'POST'), '/api/artifacts'))?.status).toBe(405);
  expect((await routes.handle(request('/api/artifacts/invalid'), '/api/artifacts/invalid'))?.status).toBe(404);
  const missing = '/api/artifacts/00000000-0000-4000-8000-000000000001';
  expect((await routes.handle(request(missing), missing))?.status).toBe(404);
  const offline = createReadRoutes({ ...deps, workspaceEnabled: false });
  expect((await offline.handle(request('/api/artifacts'), '/api/artifacts'))?.status).toBe(503);
  db.close();
});
