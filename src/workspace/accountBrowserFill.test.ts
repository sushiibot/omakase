import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { fillAccountPage, chromiumAccountFill } from "./accountBrowserFill.ts";

function page(origin = "https://example.com", confirmType = "password") {
  const events: string[] = [];
  class Input {
    disabled = false; readOnly = false; isConnected = true; stored = "";
    constructor(public type: string) {}
    get value() { return this.stored; }
    set value(value: string) { this.stored = value; }
    dispatchEvent(event: { type: string }) { events.push(event.type); }
  }
  const nodes: Record<string, Input[]> = { "#password": [new Input("password")], "#confirm": [new Input(confirmType)], "#username": [new Input("email")] };
  const globals = { location: { origin, protocol: new URL(origin).protocol }, document: { querySelectorAll: (selector: string) => nodes[selector] ?? [] }, HTMLInputElement: Input, Event: class { constructor(public type: string) {} } };
  const fill = (fields = { password: "#password", confirmPassword: "#confirm", username: "#username" }) => runInNewContext(`(${fillAccountPage.toString()})(input)`, { ...globals, input: { origin: "https://example.com", password: "SECRET", username: "owner", fields } });
  return { fill, nodes, events };
}

test("page atomically verifies origin and all fields before setting password and confirmation", () => {
  const p = page(); expect(p.fill()).toBe(true);
  expect(p.nodes["#password"]![0]!.value).toBe("SECRET");
  expect(p.nodes["#confirm"]![0]!.value).toBe("SECRET");
  expect(p.nodes["#username"]![0]!.value).toBe("owner");
  expect(p.events).toEqual(["input", "change", "input", "change", "input", "change"]);
  for (const broken of [page("https://evil.example"), page("http://example.com"), page("https://example.com", "text")]) {
    expect(() => broken.fill()).toThrow("Account fill refused");
    expect(broken.nodes["#password"]![0]!.value).toBe("");
    expect(broken.events).toEqual([]);
  }
  const duplicate = page(); duplicate.nodes["#password"]!.push(duplicate.nodes["#password"]![0]!);
  expect(() => duplicate.fill()).toThrow("Account fill refused");
});

test("private Chromium channel resolves the marked page and suppresses protocol errors", async () => {
  const messages: any[] = [];
  let exception = false;
  const server = Bun.serve({ port: 0, fetch: (req, server) => server.upgrade(req) ? undefined : new Response("", { status: 400 }), websocket: { message: (ws, raw) => {
    const msg = JSON.parse(String(raw)); messages.push(msg);
    let result: any = {};
    if (msg.method === "Target.getTargets") result = { targetInfos: [{ type: "page", targetId: "unrelated" }, { type: "page", targetId: "selected" }] };
    if (msg.method === "Target.attachToTarget") result = { sessionId: msg.params.targetId };
    if (msg.method === "Runtime.evaluate") result = { result: { value: msg.sessionId === "selected" } };
    if (exception && msg.params.expression?.includes("SECRET")) result = { exceptionDetails: { text: "SECRET" } };
    ws.send(JSON.stringify({ id: msg.id, result }));
  } } });
  try {
    const input = { origin: "https://example.com", fields: { password: "#p" }, password: "SECRET", username: "owner" };
    await chromiumAccountFill(`ws://127.0.0.1:${server.port}`, "marker", input);
    const secretMessages = messages.filter(m => JSON.stringify(m).includes("SECRET"));
    expect(secretMessages).toHaveLength(1);
    expect(secretMessages[0].sessionId).toBe("selected");
    exception = true;
    await expect(chromiumAccountFill(`ws://127.0.0.1:${server.port}`, "marker", input)).rejects.toThrow("Account fill failed");
    await expect(chromiumAccountFill("wss://evil.example", "marker", input)).rejects.toThrow("Account fill refused");
  } finally { server.stop(true); }
});
