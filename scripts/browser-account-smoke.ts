// Runs with both shipping browser engines. Only synthetic credentials are used;
// the fixture replaces example.com's body and never submits a form.
import { mkdtempSync, rmSync } from "node:fs";
import { BrowserManager, localBrowserDriver } from "../src/workspace/browser.ts";
import { AccountsClient } from "../src/workspace/accounts.ts";
import type { BrowserEngine } from "../src/orchestration/browserContracts.ts";
const home = mkdtempSync("/tmp/browser-accounts-smoke-");
const accountId = crypto.randomUUID();
const password = "smoke-only-password-123!";
const outcomes: string[] = [];
const accounts = new AccountsClient("smoke", async raw => {
  const request = raw as { operation: string; origin?: string; outcome?: string };
  if (request.operation === "fill") {
    if (request.origin !== "https://example.com") throw new Error("Unexpected credential destination");
    return { password, username: "smoke-user", version: 1, receiptId: crypto.randomUUID() };
  }
  if (request.operation === "fill_result") { outcomes.push(request.outcome!); return { ok: true }; }
  throw new Error("Unexpected credential request");
});
const manager = new BrowserManager(home, localBrowserDriver(home), Date.now, accounts);
try {
  const engines = (["chromium", "camoufox"] as BrowserEngine[]).filter(engine => !process.argv[2] || engine === process.argv[2]);
  if (!engines.length) throw new Error("Unknown browser engine");
  for (const engine of engines) {
    const binding = manager.bind("main", () => engine);
    const tool = binding.tool();
    const run = (args: string[]) => tool.execute("smoke", { args, engine, profile: "temporary" }, undefined, undefined, undefined as never);
    await run(["open", "https://example.com"]);
    await run(["eval", `document.body.innerHTML = '<input id="user"><input id="password" type="password"><input id="confirm" type="password">'; true`]);
    const result = await tool.execute("smoke", { args: ["fill-account"], engine, profile: "temporary", accountId, fields: { username: "#user", password: "#password", confirmPassword: "#confirm" } }, undefined, undefined, undefined as never);
    if (JSON.stringify(result).includes(password)) throw new Error("Credential escaped through the tool result");
    const checked = await run(["eval", `document.querySelector('#password').value === ${JSON.stringify(password)} && document.querySelector('#confirm').value === ${JSON.stringify(password)} && document.querySelector('#user').value === 'smoke-user'`]);
    if (!JSON.stringify(checked).includes("true") || outcomes.at(-1) !== "filled") throw new Error(`${engine}: credential fill failed`);
    await binding.finish();
    console.log(`${engine}: private account fill, confirmation field and audit passed`);
  }
} finally { await manager.dispose(); rmSync(home, { recursive: true, force: true }); }
