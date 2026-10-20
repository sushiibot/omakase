import { describe, expect, test } from "bun:test";
import { RpcErrorReply, WorkspaceNotConnectedError } from "../../orchestration/transport/server.ts";
import type { BlockRequest } from "../../orchestration/blockContracts.ts";
import { BlockRoutes } from "./blockRoutes.ts";

const KEY = "01JABCDEFGHJKMNPQRSTVWXYZ0";

function routes(answer: (r: BlockRequest) => unknown = () => ({ blocks: [] })) {
  const calls: BlockRequest[] = [];
  const r = new BlockRoutes({ blocksManage: async (request) => { calls.push(request); return answer(request) as never; } });
  return { r, calls };
}
const post = (body: unknown, type = "application/json") =>
  new Request("http://x/api/blocks", { method: "POST", headers: { "Content-Type": type }, body: JSON.stringify(body) });

describe("block routes", () => {
  test("lists replies' blocks by key, and refuses bad keys", async () => {
    const { r, calls } = routes();
    expect((await r.handle(new Request(`http://x/api/blocks?keys=${KEY},${KEY}`), "/api/blocks"))!.status).toBe(200);
    expect(calls).toEqual([{ action: "list", messageKeys: [KEY, KEY] }]);
    for (const q of ["", "keys=", "keys=../etc", `keys=${Array(51).fill(KEY).join(",")}`]) {
      expect((await r.handle(new Request(`http://x/api/blocks?${q}`), "/api/blocks"))!.status).toBe(400);
    }
    expect(await r.handle(new Request("http://x/api/other"), "/api/other")).toBeNull();
  });

  test("a POST only ever applies changes", async () => {
    const { r, calls } = routes();
    const ops = [{ op: "check" as const, item: 0, done: true }];
    expect((await r.handle(post({ id: `${KEY}.0`, ops }), "/api/blocks"))!.status).toBe(200);
    expect((await r.handle(post({ action: "list", id: `${KEY}.0`, ops }), "/api/blocks"))!.status).toBe(200);
    expect(calls).toEqual([{ action: "apply", id: `${KEY}.0`, ops }, { action: "apply", id: `${KEY}.0`, ops }]);
    expect((await r.handle(post({ id: `${KEY}.0`, ops: [{ op: "explode" }] }), "/api/blocks"))!.status).toBe(400);
    expect((await r.handle(post({ id: `${KEY}.0`, ops }, "text/plain"), "/api/blocks"))!.status).toBe(415);
    expect((await r.handle(new Request("http://x/api/blocks", { method: "DELETE" }), "/api/blocks"))!.status).toBe(405);
  });

  test("workspace answers map to statuses", async () => {
    const at = async (err: Error) => (await routes(() => { throw err; }).r.handle(post({ id: `${KEY}.0`, ops: [{ op: "start" }] }), "/api/blocks"))!;
    expect((await at(new RpcErrorReply("gone", -32040))).status).toBe(404);
    const refused = await at(new RpcErrorReply("this block was already answered", -32042));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "this block was already answered" });
    expect((await at(new WorkspaceNotConnectedError())).status).toBe(503);
  });
});
