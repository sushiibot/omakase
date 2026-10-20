import { describe, expect, test } from "bun:test";
import { RpcErrorReply, WorkspaceNotConnectedError } from "../../orchestration/transport/server.ts";
import type { SavedRequest } from "../../orchestration/savedContracts.ts";
import { SavedRoutes } from "./savedRoutes.ts";

const KEY = "01JABCDEFGHJKMNPQRSTVWXYZ0";
const DOC = "00000000-0000-4000-8000-000000000001";

function routes(answer: (r: SavedRequest) => unknown = () => ({ items: [] })) {
  const calls: SavedRequest[] = [];
  const r = new SavedRoutes({ savedManage: async (request) => { calls.push(request); return answer(request) as never; } });
  return { r, calls };
}
const get = (q: string) => new Request(`http://x/api/saved${q}`);
const post = (body: unknown, type = "application/json") =>
  new Request("http://x/api/saved", { method: "POST", headers: { "Content-Type": type }, body: JSON.stringify(body) });

describe("saved routes", () => {
  test("lists with filters, reads one, and refuses bad filters", async () => {
    const { r, calls } = routes();
    expect((await r.handle(get(""), "/api/saved"))!.status).toBe(200);
    expect((await r.handle(get("?conversation=trip&status=all&kind=checklist&pinned=1&q=+milk+"), "/api/saved"))!.status).toBe(200);
    expect((await r.handle(get(`?id=${KEY}.0`), "/api/saved"))!.status).toBe(200);
    expect(calls).toEqual([
      { action: "list", status: "active" },
      { action: "list", status: "all", conversationId: "trip", kind: "checklist", pinned: true, query: "milk" },
      { action: "get", id: `${KEY}.0` },
    ]);
    for (const q of ["?status=open", "?kind=chart", "?pinned=yes", "?conversation=../x", `?q=${"a".repeat(201)}`, "?id=../etc"]) {
      expect((await r.handle(get(q), "/api/saved"))!.status).toBe(400);
    }
    expect(await r.handle(get(""), "/api/savedx")).toBeNull();
  });

  test("a POST only changes an item", async () => {
    const { r, calls } = routes();
    for (const action of ["pin", "unpin", "archive", "restore", "opened"]) {
      expect((await r.handle(post({ action, id: DOC }), "/api/saved"))!.status).toBe(200);
    }
    expect(calls.map((c) => c.action)).toEqual(["pin", "unpin", "archive", "restore", "opened"]);
    expect((await r.handle(post({ action: "list" }), "/api/saved"))!.status).toBe(400);
    expect((await r.handle(post({ action: "get", id: DOC }), "/api/saved"))!.status).toBe(400);
    expect((await r.handle(post({ action: "delete", id: DOC }), "/api/saved"))!.status).toBe(400);
    expect((await r.handle(post({ action: "pin", id: "nope" }), "/api/saved"))!.status).toBe(400);
    expect((await r.handle(post({ action: "pin", id: DOC }, "text/plain"), "/api/saved"))!.status).toBe(415);
    expect((await r.handle(new Request("http://x/api/saved", { method: "DELETE" }), "/api/saved"))!.status).toBe(405);
  });

  test("workspace answers map to statuses", async () => {
    const at = async (err: Error, req = post({ action: "pin", id: DOC })) => (await routes(() => { throw err; }).r.handle(req, "/api/saved"))!;
    const gone = await at(new RpcErrorReply("This item no longer exists.", -32040));
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: "This item no longer exists." });
    expect((await at(new WorkspaceNotConnectedError())).status).toBe(503);
    expect((await at(new Error("boom"))).status).toBe(409);
    expect((await at(new Error("boom"), get(""))).status).toBe(502);
  });
});
