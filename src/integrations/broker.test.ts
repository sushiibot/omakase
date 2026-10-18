import { describe, expect, test } from "bun:test";
import {
  IntegrationBroker,
  publicAddress,
  definitionSchema,
  sendPublic,
} from "./broker.ts";
import { IntegrationSecrets } from "./secrets.ts";
import { MemoryJsonState } from "../db/jsonState.ts";
import { Integrations } from "./service.ts";
import { IntegrationRoutes } from "../surfaces/web/integrationRoutes.ts";
const definition = {
  id: "example",
  name: "Example",
  capability: "Search",
  origin: "https://api.example.com",
  docsUrl: "https://example.com/docs",
  auth: { type: "bearer" },
  operations: [
    {
      id: "search",
      description: "Search records",
      method: "POST",
      path: "/v1/search",
      query: ["q"],
      body: true,
    },
  ],
};
function harness() {
  const state = new MemoryJsonState();
  const secrets = new IntegrationSecrets(state, Buffer.alloc(32, 7));
  const calls: unknown[] = [];
  const broker = new IntegrationBroker(state, secrets, async (...args) => {
    calls.push(args);
    return {
      status: 200,
      body: { value: "test-provider-secret", data: [1, 2] },
    };
  });
  const proposed = broker.propose(definition)!;
  const approve = () =>
    broker.save("example", {
      key: "test-provider-secret",
      revision: proposed.revision,
      approved: true,
    });
  return { state, secrets, calls, broker, proposed, approve };
}
describe("integration broker policy", () => {
  test("proposals cannot use secrets before owner approval; live discovery contains no keys", async () => {
    const h = harness();
    await expect(
      h.broker.execute({ integration: "example", operation: "search" }),
    ).rejects.toThrow("Setup required");
    expect(h.calls).toHaveLength(0);
    expect(() =>
      h.broker.save("example", {
        key: "test-provider-secret",
        revision: h.proposed.revision,
      }),
    ).toThrow();
    expect(() =>
      h.broker.save("example", {
        key: "test-provider-secret",
        revision: "stale",
        approved: true,
      }),
    ).toThrow();
    h.approve();
    expect(h.broker.list()[0]?.status).toBe("ready");
    const response = await h.broker.execute({
      integration: "example",
      operation: "search",
      query: { q: "coffee" },
      body: { limit: 2 },
    });
    expect(response).toEqual({
      status: 200,
      body: { value: "[redacted]", data: [1, 2] },
    });
    expect(String((h.calls[0] as unknown[])[0])).toBe(
      "https://api.example.com/v1/search?q=coffee",
    );
    expect((h.calls[0] as unknown[])[2]).toMatchObject({
      authorization: "Bearer test-provider-secret",
    });
    expect(JSON.stringify(h.broker.list())).not.toContain(
      "test-provider-secret",
    );
    expect([...h.state.map.values()].join()).not.toContain(
      "test-provider-secret",
    );
  });
  test("approved destinations and operations cannot be changed by a subsequent proposal", () => {
    const h = harness();
    h.approve();
    expect(h.broker.propose(definition)?.revision).toBe(h.proposed.revision);
    expect(() =>
      h.broker.propose({ ...definition, origin: "https://attacker.example" }),
    ).toThrow("already exists");
    h.broker.remove("example");
    expect(h.secrets.has("example")).toBe(false);
    const replacement = h.broker.propose(definition)!;
    expect(replacement.revision).not.toBe(h.proposed.revision);
    expect(() =>
      h.broker.save("example", {
        key: "test-provider-secret",
        revision: h.proposed.revision,
        approved: true,
      }),
    ).toThrow();
  });
  test("rejects caller destinations, headers, unknown operations and query fields", async () => {
    const h = harness();
    h.approve();
    for (const extra of [
      { url: "https://evil.example" },
      { headers: { authorization: "stolen" } },
      { query: { redirect: "https://evil.example" } },
      { operation: "delete" },
    ]) {
      await expect(
        h.broker.execute({
          integration: "example",
          operation: "search",
          ...extra,
        }),
      ).rejects.toThrow();
    }
    expect(h.calls).toHaveLength(0);
  });
  test("limits request sizes and rate, and revocation applies without restart", async () => {
    const h = harness();
    h.approve();
    await expect(
      h.broker.execute({
        integration: "example",
        operation: "search",
        body: "x".repeat(32768),
      }),
    ).rejects.toThrow("32 KiB");
    for (let i = 0; i < 30; i++)
      await h.broker.execute({ integration: "example", operation: "search" });
    await expect(
      h.broker.execute({ integration: "example", operation: "search" }),
    ).rejects.toThrow("limit");
    h.broker.remove("example");
    await expect(
      h.broker.execute({ integration: "example", operation: "search" }),
    ).rejects.toThrow("Setup required");
  });
  test("owner route requires same-origin JSON and revision approval; no secret read route", async () => {
    const h = harness();
    const service = new Integrations(
      h.secrets,
      fetch,
      () => undefined,
      h.broker,
    );
    const routes = new IntegrationRoutes(service);
    const url = "https://omakase.example/api/integrations/example";
    const req = (origin: string, body: unknown) =>
      new Request(url, {
        method: "PUT",
        headers: {
          origin,
          "sec-fetch-site":
            origin === "https://omakase.example" ? "same-origin" : "cross-site",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    expect(
      (
        await routes.handle(
          req("https://evil.example", {}),
          "/api/integrations/example",
        )
      )?.status,
    ).toBe(403);
    expect(
      (
        await routes.handle(
          req("https://omakase.example", {
            key: "test-provider-secret",
            revision: h.proposed.revision,
            approved: true,
          }),
          "/api/integrations/example",
        )
      )?.status,
    ).toBe(200);
    expect(
      (await routes.handle(new Request(url), "/api/integrations/example"))
        ?.status,
    ).toBe(405);
  });
});
test("schema rejects ambiguous URLs, paths and unsafe auth headers", () => {
  for (const origin of [
    "http://example.com",
    "https://127.0.0.1",
    "https://[::1]",
    "https://api.example.com:444",
    "https://user:pass@api.example.com",
    "https://api.example.com/",
  ])
    expect(definitionSchema.safeParse({ ...definition, origin }).success).toBe(
      false,
    );
  for (const path of [
    "//evil.com",
    "/../admin",
    "/v1/%2e%2e/admin",
    "/v1/search?x=y",
    "/v1\\admin",
  ])
    expect(
      definitionSchema.safeParse({
        ...definition,
        operations: [{ ...definition.operations[0], path }],
      }).success,
    ).toBe(false);
  for (const name of [
    "Host",
    "Cookie",
    "Proxy-Authorization",
    "Content-Length",
    "X-Forwarded-Host",
  ])
    expect(
      definitionSchema.safeParse({
        ...definition,
        auth: { type: "header", name },
      }).success,
    ).toBe(false);
});
test("public address policy covers IPv4, IPv6 and mapped-address bypasses", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.100.100.200",
    "172.16.0.1",
    "192.168.1.2",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::",
  ])
    expect(publicAddress(ip)).toBe(false);
  for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])
    expect(publicAddress(ip)).toBe(true);
});
test("real transport rejects local resolution before sending credentials", async () => {
  await expect(
    sendPublic(new URL("https://localhost/"), "GET", {
      authorization: "secret",
    }),
  ).rejects.toThrow("public addresses");
});

test("quoted credential values are redacted after JSON decoding", async () => {
  const state = new MemoryJsonState();
  const secrets = new IntegrationSecrets(state, Buffer.alloc(32, 9));
  const key = 'provider-"quoted"-credential';
  const broker = new IntegrationBroker(state, secrets, async () => ({
    status: 200,
    body: { echo: key, nested: [key] },
  }));
  const proposed = broker.propose(definition)!;
  broker.save("example", { key, revision: proposed.revision, approved: true });
  expect(
    await broker.execute({ integration: "example", operation: "search" }),
  ).toEqual({
    status: 200,
    body: { echo: "[redacted]", nested: ["[redacted]"] },
  });
});
