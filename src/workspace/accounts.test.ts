import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromiumAccountFill } from "./accountBrowserFill.ts";
import { AccountsClient } from "./accounts.ts";
import { BrowserManager, type BrowserDriver } from "./browser.ts";

const id = "f76ddca9-2aa5-469f-995a-38244264c3a2";
for (const engine of ["chromium", "camoufox"] as const) test(`${engine}: secrets stay out of tool arguments, CLI commands and results`, async () => {
  const dir = mkdtempSync(join(tmpdir(), "account-browser-"));
  const commands: string[][] = [];
  const requests: any[] = [];
  const fills: any[] = [];
  const client = new AccountsClient("owner", async p => {
    requests.push(p);
    return (p as any).operation === "fill" ? { password: "SECRET-value", username: "owner", version: 2, receiptId: "receipt" } : { ok: true };
  });
  const driver: BrowserDriver = { run: async (_, args) => { commands.push(args); return args[0] === "get" ? "https://example.com/register" : "ok"; }, connect: () => { throw new Error(); }, fillAccount: async (_, input) => { fills.push(input); } };
  const manager = new BrowserManager(dir, driver, Date.now, client);
  try {
    const tool = manager.bind("main", () => "run-1").tool();
    const args = { args: ["fill-account"], accountId: id, fields: { password: "#password", confirmPassword: "#confirm", username: "#username" }, engine };
    const result = await tool.execute("call", args, undefined, undefined, {} as never);
    expect(JSON.stringify({ args, commands, result })).not.toContain("SECRET-value");
    expect(fills).toEqual([{ origin: "https://example.com", fields: args.fields, password: "SECRET-value", username: "owner" }]);
    expect(requests).toEqual([
      { principalId: "owner", operation: "fill", accountId: id, version: undefined, origin: "https://example.com", engine, runId: "run-1" },
      { principalId: "owner", operation: "fill_result", receiptId: "receipt", outcome: "filled" },
    ]);
  } finally { await manager.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("failed private fills expose fixed errors and record failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "account-browser-"));
  const requests: any[] = [];
  const client = new AccountsClient("owner", async p => { requests.push(p); return (p as any).operation === "fill" ? { password: "SECRET", username: "owner", version: 1, receiptId: "receipt" } : { ok: true }; });
  const manager = new BrowserManager(dir, { run: async (_, args) => args[0] === "get" ? "https://example.com" : "ok", connect: () => { throw new Error(); }, fillAccount: async () => { throw new Error("SECRET"); } }, Date.now, client);
  try {
    await expect(manager.bind("main", () => "run").tool().execute("call", { args: ["fill-account"], accountId: id, fields: { password: "#password" } }, undefined, undefined, {} as never)).rejects.toThrow("Account fill did not complete. Fields may be filled. Inspect the page and account origin before retrying.");
    expect(requests.at(-1).outcome).toBe("failed");
  } finally { await manager.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("redaction malformed responses and disconnected gateway fail closed without echoing data", async () => {
  for (const result of [null, {}, { wrong: "SECRET" }]) {
    const client = new AccountsClient("owner", async () => result);
    await expect(client.redact({ message: "SECRET" })).rejects.toThrow("Credential scan failed; model request blocked.");
  }
  const client = new AccountsClient("owner", async () => { throw new Error("SECRET"); });
  await expect(client.fill({ accountId: id, fields: { password: "#password" } }, "https://example.com", "chromium")).rejects.toThrow("Account fill unavailable.");
});


test("a successful fill with failed audit acknowledgement never records a failed fill", async () => {
  const dir = mkdtempSync(join(tmpdir(), "account-browser-"));
  const requests: any[] = [];
  const client = new AccountsClient("owner", async p => {
    requests.push(p);
    if ((p as any).operation === "fill") return { password: "SECRET", username: "owner", version: 1, receiptId: "receipt" };
    throw new Error("Audit offline");
  });
  let filled = false;
  const manager = new BrowserManager(dir, { run: async (_, args) => args[0] === "get" ? "https://example.com" : "ok", connect: () => { throw new Error(); }, fillAccount: async () => { filled = true; } }, Date.now, client);
  try {
    await expect(manager.bind("main", () => "run").tool().execute("call", { args: ["fill-account"], accountId: id, fields: { password: "#password" } }, undefined, undefined, {} as never)).rejects.toThrow("Fields may be filled; audit unavailable. Inspect the page before retrying.");
    expect(filled).toBe(true);
    expect(requests.filter(p => p.operation === "fill_result").map(p => p.outcome)).toEqual(["filled"]);
  } finally { await manager.dispose(); rmSync(dir, { recursive: true, force: true }); }
});


for (const cleanupFailure of ["protocol-error", "socket-close"] as const) test(`confirmed Chromium fill remains audited as filled after detach ${cleanupFailure}`, async () => {
  const dir = mkdtempSync(join(tmpdir(), "account-browser-"));
  const requests: any[] = [];
  let detachAttempted = false;
  const server = Bun.serve({ port: 0, fetch: (req, server) => server.upgrade(req) ? undefined : new Response("", { status: 400 }), websocket: { message: (ws, raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.method === "Target.detachFromTarget") {
      detachAttempted = true;
      if (cleanupFailure === "socket-close") ws.close();
      else ws.send(JSON.stringify({ id: msg.id, error: { message: "Target closed" } }));
      return;
    }
    const result = msg.method === "Target.getTargets" ? { targetInfos: [{ type: "page", targetId: "selected" }] }
      : msg.method === "Target.attachToTarget" ? { sessionId: "selected" }
      : { result: { value: true } };
    ws.send(JSON.stringify({ id: msg.id, result }));
  } } });
  const client = new AccountsClient("owner", async p => {
    requests.push(p);
    return (p as any).operation === "fill" ? { password: "SECRET", username: "owner", version: 1, receiptId: "receipt" } : { ok: true };
  });
  const manager = new BrowserManager(dir, {
    run: async (_, args) => args[0] === "get" ? "https://example.com" : "ok",
    connect: () => { throw new Error(); },
    fillAccount: async (_, input, signal) => chromiumAccountFill(`ws://127.0.0.1:${server.port}`, "marker", input, signal),
  }, Date.now, client);
  try {
    const result = await manager.bind("main", () => "run").tool().execute("call", { args: ["fill-account"], accountId: id, fields: { password: "#password" } }, undefined, undefined, {} as never);
    expect(JSON.stringify(result)).toContain("Account fields filled.");
    expect(detachAttempted).toBe(true);
    expect(requests.filter(p => p.operation === "fill_result").map(p => p.outcome)).toEqual(["filled"]);
  } finally { await manager.dispose(); server.stop(true); rmSync(dir, { recursive: true, force: true }); }
});
