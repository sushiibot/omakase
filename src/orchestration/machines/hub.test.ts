import { expect, test } from "bun:test";
import { MachineHub } from "./hub.ts";
import { OrchestrationServer } from "../transport/server.ts";
const token = "a".repeat(40);
test("machine tokens bind one identity and cannot be reused as workspace credentials", () => {
  const hub = new MachineHub([
    { id: "pc", name: "PC", token },
    { id: "files", name: "Files", token: "b".repeat(40) },
  ]);
  const req = (id: string, secret: string) =>
    new Request("http://local/machines", {
      headers: { "X-Sushii-Machine": id, Authorization: `Bearer ${secret}` },
    });
  expect(hub.authorize(req("pc", token))).toBe("pc");
  expect(hub.authorize(req("files", token))).toBeNull();
  expect(hub.authorize(req("pc", "wrong"))).toBeNull();
  expect(
    () =>
      new MachineHub([
        { id: "pc", name: "PC", token },
        { id: "files", name: "Files", token },
      ]),
  ).toThrow("unique");
  expect(() =>
    new OrchestrationServer({
      secretGrants: { [token]: { principalId: "owner" } },
    }).setMachineHub(hub),
  ).toThrow("differ");
});
test("a replaced machine socket cannot settle requests or disconnect the new socket", async () => {
  const hub = new MachineHub([{ id: "pc", name: "PC", token }]);
  const sent: any[] = [];
  const first = {
    send: (s: string) => sent.push(JSON.parse(s)),
    close: () => {},
  };
  const second = {
    send: (s: string) => sent.push(JSON.parse(s)),
    close: () => {},
  };
  hub.open("pc", first);
  const firstCall = sent[0];
  hub.message(
    "pc",
    first,
    JSON.stringify({
      jsonrpc: "2.0",
      id: firstCall.id,
      result: { name: "PC", roots: [], providers: [] },
    }),
  );
  await Promise.resolve();
  hub.open("pc", second);
  const secondCall = sent[1];
  hub.close("pc", first);
  hub.message(
    "pc",
    first,
    JSON.stringify({
      jsonrpc: "2.0",
      id: secondCall.id,
      result: { name: "Old", roots: [], providers: [] },
    }),
  );
  hub.message(
    "pc",
    second,
    JSON.stringify({
      jsonrpc: "2.0",
      id: secondCall.id,
      result: { name: "PC", roots: [], providers: [] },
    }),
  );
  await Promise.resolve();
  expect(hub.list()[0]!.connected).toBe(true);
  hub.stop();
});
test("session changes arrive as notifications and as a snapshot; an older daemon without one stays connected", async () => {
  const hub = new MachineHub([{ id: "pc", name: "PC", token }]);
  const seen: unknown[] = [];
  hub.setSessionListener((machineId, s) => seen.push([machineId, s]));
  const sent: any[] = [];
  let closed = false;
  const socket = { send: (s: string) => sent.push(JSON.parse(s)), close: () => void (closed = true) };
  hub.open("pc", socket);
  expect(sent[0]).toMatchObject({ method: "machine/info", params: { features: ["sessionEvents"] } });
  const summary = { sessionId: "a-1", taskId: "", stateVersion: 3, status: "completed" };
  // Before machine/info answers, a notification is not trusted.
  hub.message("pc", socket, JSON.stringify({ jsonrpc: "2.0", method: "machine/sessionChanged", params: summary }));
  hub.message("pc", socket, JSON.stringify({ jsonrpc: "2.0", id: sent[0].id, result: { name: "PC", roots: [], providers: [] } }));
  await Bun.sleep(0);
  expect(sent[1]).toMatchObject({ method: "machine/sessions" });
  hub.message("pc", socket, JSON.stringify({ jsonrpc: "2.0", id: sent[1].id, result: [summary, { bad: true }] }));
  await Bun.sleep(0);
  expect(hub.supportsEvents("pc")).toBe(true);
  hub.message("pc", socket, JSON.stringify({ jsonrpc: "2.0", method: "machine/sessionChanged", params: { ...summary, stateVersion: 4 } }));
  hub.message("pc", socket, JSON.stringify({ jsonrpc: "2.0", method: "machine/heartbeat" }));
  expect(seen).toEqual([
    ["pc", summary],
    ["pc", { ...summary, stateVersion: 4 }],
  ]);

  const old = { send: (s: string) => sent.push(JSON.parse(s)), close: () => void (closed = true) };
  hub.open("pc", old);
  const info = sent.at(-1);
  hub.message("pc", old, JSON.stringify({ jsonrpc: "2.0", id: info.id, result: { name: "PC", roots: [], providers: [] } }));
  await Bun.sleep(0);
  const probe = sent.at(-1);
  closed = false;
  hub.message("pc", old, JSON.stringify({ jsonrpc: "2.0", id: probe.id, error: { code: -32000, message: "Unknown machine operation." } }));
  await Bun.sleep(0);
  expect(closed).toBe(false);
  expect(hub.list()[0]!.connected).toBe(true);
  expect(hub.supportsEvents("pc")).toBe(false);
  hub.stop();
});
test("a snapshot that fails for a reason other than an older daemon is retried", async () => {
  const hub = new MachineHub([{ id: "pc", name: "PC", token }]);
  hub.snapshotRetryMs = 5;
  const sent: any[] = [];
  const socket = { send: (s: string) => sent.push(JSON.parse(s)), close: () => {} };
  hub.open("pc", socket);
  hub.message("pc", socket, JSON.stringify({ jsonrpc: "2.0", id: sent[0].id, result: { name: "PC", roots: [], providers: [] } }));
  await Bun.sleep(0);
  hub.message("pc", socket, JSON.stringify({ jsonrpc: "2.0", id: sent[1].id, error: { code: -32000, message: "Machine is busy" } }));
  await Bun.sleep(30);
  expect(sent[2]).toMatchObject({ method: "machine/sessions" });
  hub.message("pc", socket, JSON.stringify({ jsonrpc: "2.0", id: sent[2].id, result: [] }));
  await Bun.sleep(0);
  expect(hub.supportsEvents("pc")).toBe(true);
  hub.stop();
});
