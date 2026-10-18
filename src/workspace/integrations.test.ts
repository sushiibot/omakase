import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  callIntegration,
  integrationSocket,
  startCliProxy,
  startIntegrationBridge,
} from "./integrations.ts";
import { definitionSchema, IntegrationBroker } from "../integrations/broker.ts";
import { MemoryJsonState } from "../db/jsonState.ts";
import { IntegrationSecrets } from "../integrations/secrets.ts";
const definition = definitionSchema.parse({
  id: "example",
  name: "Example",
  capability: "Search",
  origin: "https://api.example.com",
  docsUrl: "https://example.com/docs",
  auth: { type: "bearer" },
  operations: [
    {
      id: "search",
      description: "Search",
      method: "GET",
      path: "/v1/search",
      query: ["q"],
    },
  ],
});
test("CLI proxy forwards only approved operations; real curl uses gateway-held credential", async () => {
  const dir = mkdtempSync(join(tmpdir(), "integration-cli-"));
  const state = new MemoryJsonState();
  const secrets = new IntegrationSecrets(state, Buffer.alloc(32, 3));
  const upstream: unknown[] = [];
  const broker = new IntegrationBroker(state, secrets, async (...args) => {
    upstream.push(args);
    return { status: 200, body: { found: 1 } };
  });
  const proposed = broker.propose(definition)!;
  broker.save("example", {
    key: "gateway-secret",
    revision: proposed.revision,
    approved: true,
  });
  const bridge = await startIntegrationBridge(dir, async (raw) =>
    broker.execute((raw as { request: unknown }).request),
  );
  const proxy = await startCliProxy(definition, (args) =>
    callIntegration(integrationSocket(dir), args),
  );
  try {
    expect(statSync(integrationSocket(dir)).mode & 0o777).toBe(0o600);
    const command = Bun.spawn(
      [
        "curl",
        "--silent",
        "--show-error",
        `${proxy.baseUrl}/v1/search?q=coffee`,
        "-H",
        `Authorization: Bearer ${proxy.token}`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(await new Response(command.stdout).json()).toEqual({ found: 1 });
    expect(await command.exited).toBe(0);
    expect((upstream[0] as unknown[])[2]).toMatchObject({
      authorization: "Bearer gateway-secret",
    });
    for (const path of [
      "/admin",
      "/v1/search?unexpected=x",
      "/v1/search?q=a&q=b",
    ]) {
      expect(
        (
          await fetch(proxy.baseUrl + path, {
            headers: { authorization: `Bearer ${proxy.token}` },
          })
        ).status,
      ).toBeGreaterThanOrEqual(400);
    }
    expect((await fetch(proxy.baseUrl + "/v1/search")).status).toBe(403);
    expect(
      (
        await fetch(proxy.baseUrl + "/v1/search", {
          headers: {
            authorization: `Bearer ${proxy.token}`,
            origin: "https://evil.example",
          },
        })
      ).status,
    ).toBe(403);
    expect(upstream).toHaveLength(1);
    broker.remove("example");
    expect(
      (
        await fetch(proxy.baseUrl + "/v1/search", {
          headers: { authorization: `Bearer ${proxy.token}` },
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect(upstream).toHaveLength(1);
  } finally {
    proxy.close();
    await bridge.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI can authenticate with its configured API-key header using only the local token", async () => {
  const proxy = await startCliProxy(
    { ...definition, auth: { type: "header", name: "X-Api-Key" } },
    async () => ({ status: 200, body: { ok: true } }),
  );
  try {
    expect(
      (
        await fetch(proxy.baseUrl + "/v1/search", {
          headers: { "X-Api-Key": proxy.token },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(proxy.baseUrl + "/v1/search", {
          headers: { "X-Api-Key": "wrong" },
        })
      ).status,
    ).toBe(403);
  } finally {
    proxy.close();
  }
});
