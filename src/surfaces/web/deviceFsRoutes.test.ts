import { expect, test } from "bun:test";
import { DeviceFiles } from "../../orchestration/machines/deviceFs.ts";
import { deviceFsRoute } from "./deviceFsRoutes.ts";
const id = "phone-11111111-1111-4111-8111-111111111111";
function post(action: string, body: unknown) {
  const path = `/api/machines/phone/${action}`;
  return { path, req: new Request(`https://example.com${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) };
}
test("phone HTTP transport dispatches and replies to a machine file operation", async () => {
  const hub = new DeviceFiles();
  const call = async (action: string, body: unknown) => { const { req, path } = post(action, body); return (await deviceFsRoute(hub, req, path))!; };
  const { session } = await (await call("connect", { id, name: "Local files", version: 3, roots: [{ id: "vault", name: "Documents" }] })).json();
  const result = hub.request({ action: "read", machineId: id, rootId: "vault", path: "config.json" });
  const { requests } = await (await call("poll", { session })).json();
  expect(requests).toHaveLength(1);
  expect(hub.list()[0]!.fileTypes).toBe("all");
  await call("result", { session, id: requests[0].id, result: { content: "note" } });
  expect(await result).toEqual({ content: "note" });
  await call("disconnect", { session });
  expect(hub.list()).toEqual([]);
});
test("only exact POST endpoints match and oversized responses are refused", async () => {
  const hub = new DeviceFiles();
  const get = new Request("https://example.com/api/machines/phone/connect");
  expect((await deviceFsRoute(hub, get, new URL(get.url).pathname))!.status).toBe(405);
  const other = post("anything/connect", {});
  expect((await deviceFsRoute(hub, other.req, other.path))!.status).toBe(404);
  const big = post("result", { content: "x".repeat(1600001) });
  expect((await deviceFsRoute(hub, big.req, big.path))!.status).toBe(413);
});
