import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { AccountsClient } from "../workspace/accounts.ts";
import { protectModelRuntime } from "./outboundRedaction.ts";

test("all runtime completion APIs scan final provider payload, after earlier payload hooks, before HTTP", async () => {
  const bodies: any[] = [];
  const server = Bun.serve({ port: 0, fetch: async request => {
    bodies.push(await request.json());
    return new Response('data: {"id":"test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
  } });
  const dir = mkdtempSync(join(tmpdir(), "account-runtime-"));
  try {
    const authPath = join(dir, "auth.json"), modelsPath = join(dir, "models.json");
    writeFileSync(authPath, "{}"); writeFileSync(modelsPath, "{}");
    const runtime = await ModelRuntime.create({ authPath, modelsPath });
    runtime.registerProvider("scan-test", { api: "openai-completions", baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "test", models: [{ id: "test", name: "test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 1000 }] });
    const model = runtime.getModel("scan-test", "test")!;
    let fail = false;
    let scanned = 0;
    const accounts = new AccountsClient("owner", async params => {
      const payload = (params as { payload: unknown }).payload;
      scanned++;
      if (fail) throw new Error("SECRET scan failure");
      return { payload: JSON.parse(JSON.stringify(payload).replaceAll("SECRET", "[redacted]")) };
    });
    protectModelRuntime(runtime, (payload, provider) => accounts.redact(payload, provider));
    const context = { messages: [{ role: "user" as const, content: "SECRET", timestamp: Date.now() }] };
    const options = { onPayload: (payload: unknown) => ({ ...(payload as object), user: "SECRET-added-by-extension" }) };
    for (const method of ["stream", "streamSimple", "complete", "completeSimple"] as const) {
      const response = runtime[method](model, context, options);
      const output = "result" in response ? await response.result() : await response;
      expect(output.stopReason).toBe("stop");
    }
    expect(scanned).toBe(4); expect(bodies).toHaveLength(4);
    expect(JSON.stringify(bodies)).not.toContain("SECRET");
    expect(bodies[0].user).toBe("[redacted]-added-by-extension");
    fail = true;
    for (const method of ["stream", "streamSimple", "complete", "completeSimple"] as const) {
      const response = runtime[method](model, context, options);
      const output = "result" in response ? await response.result() : await response;
      expect(output.stopReason).toBe("error");
      expect(output.errorMessage).toContain("Credential scan failed; model request blocked.");
      expect(output.errorMessage).not.toContain("SECRET");
    }
    expect(scanned).toBe(8); expect(bodies).toHaveLength(4);
    fail = false;
    const unchanged = await runtime.complete(model, context, { onPayload: () => undefined });
    expect(unchanged.stopReason).toBe("stop");
    expect(JSON.stringify(bodies)).not.toContain("SECRET");
    const hookFailure = await runtime.complete(model, context, { onPayload: () => { throw new Error("SECRET"); } });
    expect(hookFailure.stopReason).toBe("error");
    expect(hookFailure.errorMessage).not.toContain("SECRET");
    expect(bodies).toHaveLength(5);
  } finally { server.stop(true); rmSync(dir, { recursive: true, force: true }); }
}, 30_000);
