import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryJsonState } from "../db/jsonState.ts";
import { IntegrationSecrets, secretEncryptionKey } from "./secrets.ts";
import { Integrations } from "./service.ts";
import { IntegrationRoutes } from "../surfaces/web/integrationRoutes.ts";

const key = "test-google-key-1234567890";
function fixture(fetchImpl: (input: string, init: RequestInit) => Promise<Response> = (async () => Response.json({ places: [{ id: "place" }] }))) {
  const state = new MemoryJsonState();
  const encryption = Buffer.alloc(32, 1);
  const secrets = new IntegrationSecrets(state, encryption);
  const service = new Integrations(secrets, fetchImpl);
  return { state, encryption, secrets, service, routes: new IntegrationRoutes(service) };
}

test("encrypted credentials survive reopening; wrong keys and swapped records fail closed", () => {
  const { state, encryption, secrets } = fixture();
  secrets.set("google_maps", key);
  expect(JSON.stringify([...state.map])).not.toContain(key);
  expect(new IntegrationSecrets(state, encryption).get("google_maps")).toBe(key);
  expect(() => new IntegrationSecrets(state, Buffer.alloc(32, 2)).get("google_maps")).toThrow("could not be opened");
  state.map.set("integration-secret:other", state.map.get("integration-secret:google_maps")!);
  expect(() => secrets.get("other")).toThrow("could not be opened");
  secrets.remove("google_maps");
  expect(secrets.get("google_maps")).toBeUndefined();
});

test("encryption key is private and stable across restarts", () => {
  const dir = mkdtempSync(join(tmpdir(), "integration-key-"));
  try {
    const path = join(dir, "key");
    const first = secretEncryptionKey(path);
    expect(secretEncryptionKey(path)).toEqual(first);
    expect(readFileSync(path).length).toBe(32);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  } finally { rmSync(dir, { recursive: true }); }
});

test("missing-key guidance and live status never disclose the saved credential", async () => {
  const { service } = fixture();
  expect(await service.action({ action: "google_maps_search", query: "coffee" })).toMatchObject({ status: "setup_required" });
  await service.save("google_maps", { key });
  const status = await service.action({ action: "list" });
  expect(status).toMatchObject({ integrations: [{ configured: true, setupUrl: "/connectors/keys" }] });
  expect(JSON.stringify(status)).not.toContain(key);
  service.remove("google_maps");
  expect(service.list()[0]!.configured).toBe(false);
});

test("credential goes only to fixed Google endpoint; redirects disabled; reflected values redacted", async () => {
  let calls = 0;
  const { service } = fixture((async (url, options) => {
    calls++;
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(options?.redirect).toBe("error");
    expect(new Headers(options?.headers).get("X-Goog-Api-Key")).toBe(key);
    return Response.json({ places: [{ displayName: { text: key } }] });
  }));
  await service.save("google_maps", { key });
  const result = await service.action({ action: "google_maps_search", query: "coffee" });
  expect(calls).toBe(2);
  expect(JSON.stringify(result)).not.toContain(key);
  expect(JSON.stringify(result)).toContain("[redacted]");
});

test("failed validation retains the working key and never forwards provider error bodies", async () => {
  const { service, secrets } = fixture((async () => new Response(key, { status: 403 })));
  secrets.set("google_maps", "previous-key");
  await expect(service.save("google_maps", { key })).rejects.toThrow("Google Maps rejected");
  expect(secrets.get("google_maps")).toBe("previous-key");
});

test("secure endpoint validates body, refuses cross-site writes and never returns keys", async () => {
  const { routes } = fixture();
  const path = "/api/integrations/google_maps";
  const req = (body: unknown, site = "same-origin") => new Request(`https://example.test${path}`, { method: "PUT", headers: { "Content-Type": "application/json", "Sec-Fetch-Site": site }, body: JSON.stringify(body) });
  expect((await routes.handle(req({ key }, "cross-site"), path))!.status).toBe(403);
  expect((await routes.handle(req({ key, extra: true }), path))!.status).toBe(400);
  expect((await routes.handle(req({ key: "a".repeat(2000) }), path))!.status).toBe(413);
  const saved = (await routes.handle(req({ key }), path))!;
  expect(saved.status).toBe(200);
  expect(saved.headers.get("Cache-Control")).toBe("no-store");
  expect(await saved.text()).not.toContain(key);
  expect((await routes.handle(new Request(`https://example.test${path}`), path))!.status).toBe(405);
});

test("removal during validation cannot resurrect a credential", async () => {
  let finish!: (response: Response) => void;
  const { service, secrets } = fixture((() => new Promise<Response>(resolve => { finish = resolve; })));
  const pending = service.save("google_maps", { key });
  service.remove("google_maps");
  finish(Response.json({ places: [] }));
  await expect(pending).rejects.toThrow("Setup changed");
  expect(secrets.has("google_maps")).toBe(false);
});

test("missing encryption key with saved credentials is never silently replaced", () => {
  const dir = mkdtempSync(join(tmpdir(), "integration-key-"));
  try { expect(() => secretEncryptionKey(join(dir, "missing"), true)).toThrow("Restore it"); }
  finally { rmSync(dir, { recursive: true }); }
});

test("saved keys override deployment fallback for the existing Maps CLI", async () => {
  const { secrets } = fixture();
  const service = new Integrations(secrets, async () => Response.json({ places: [] }), () => "deployment-key");
  expect(service.googleMapsKey()).toBe("deployment-key");
  expect(service.list()[0]).toMatchObject({ configured: true, source: "environment" });
  await service.save("google_maps", { key });
  expect(service.googleMapsKey()).toBe(key);
  expect(service.list()[0]).toMatchObject({ source: "saved" });
  service.remove("google_maps");
  expect(service.googleMapsKey()).toBe("deployment-key");
});
