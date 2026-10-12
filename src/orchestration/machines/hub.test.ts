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
