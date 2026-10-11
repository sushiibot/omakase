import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { assertExactTools, autoCompactionSettings, clearOpenRouterCatalog, maxOutputTokensFor, openRouterCatalog, reserveTokensFor, resolveModelInfo } from "./piShared.ts";

const catalog = {
  data: [
    { id: "vendor/text-only", context_length: 128_000, architecture: { input_modalities: ["text"] } },
    { id: "vendor/vision", context_length: 200_000, architecture: { input_modalities: ["text", "image"] } },
    { id: "vendor/bare", context_length: 64_000 },
  ],
};

let spy: ReturnType<typeof spyOn> | null = null;
beforeEach(() => clearOpenRouterCatalog());
afterEach(() => {
  spy?.mockRestore();
  spy = null;
  clearOpenRouterCatalog();
});

function serve(response: () => Promise<Response>) {
  spy = spyOn(globalThis, "fetch").mockImplementation((() => response()) as unknown as typeof fetch);
}

describe("resolveModelInfo", () => {
  test("image input is declared only when the catalog lists it", async () => {
    serve(async () => Response.json(catalog));
    expect(await resolveModelInfo("vendor/text-only", 1)).toMatchObject({ contextWindow: 128_000, image: false });
    expect(await resolveModelInfo("vendor/vision", 1)).toMatchObject({ contextWindow: 200_000, image: true });
    expect(await resolveModelInfo("vendor/bare", 1)).toMatchObject({ contextWindow: 64_000, image: false });
  });

  test("an unknown model, an HTTP error or a network failure falls back to text-only and the given window", async () => {
    serve(async () => Response.json(catalog));
    expect(await resolveModelInfo("vendor/missing", 42)).toMatchObject({ contextWindow: 42, image: false });
    spy!.mockRestore();
    clearOpenRouterCatalog();
    serve(async () => new Response("down", { status: 503 }));
    expect(await resolveModelInfo("vendor/vision", 42)).toMatchObject({ contextWindow: 42, image: false });
    spy!.mockRestore();
    clearOpenRouterCatalog();
    serve(async () => Promise.reject(new Error("offline")));
    expect(await resolveModelInfo("vendor/vision", 42)).toMatchObject({ contextWindow: 42, image: false });
  });

  test("a model with no catalog entry or known window fails loudly instead of guessing a window", async () => {
    serve(async () => Response.json(catalog));
    await expect(resolveModelInfo("vendor/unknown", 0)).rejects.toThrow("Cannot determine context window for vendor/unknown");
  });
});

test("the catalog drops entries without a window and is fetched once per ten minutes", async () => {
  let calls = 0;
  serve(async () => {
    calls++;
    return Response.json({ data: [{ id: "vendor/chat", context_length: 8_000 }, { id: "vendor/broken" }] });
  });
  const t = Date.parse("2026-10-01T00:00:00Z");
  expect(await openRouterCatalog(t)).toEqual([{ id: "vendor/chat", contextWindow: 8_000, image: false }]);
  await openRouterCatalog(t + 9 * 60_000);
  expect(calls).toBe(1);
  await openRouterCatalog(t + 11 * 60_000);
  expect(calls).toBe(2);
});

test("reserve puts the compaction trigger at the configured tokens, capped at 75% of the window", () => {
  expect(272_000 - reserveTokensFor(272_000, 200_000)).toBe(200_000);
  expect(200_000 - reserveTokensFor(200_000, 200_000)).toBe(150_000);
  expect(128_000 - reserveTokensFor(128_000, 200_000)).toBe(96_000);
});

test("max output tokens stay under a quarter of the window, so a small window still leaves room for the prompt", () => {
  expect(maxOutputTokensFor(1_000_000, 65_536)).toBe(65_536);
  expect(maxOutputTokensFor(65_536, 65_536)).toBe(16_384);
  expect(maxOutputTokensFor(32_000, 65_536)).toBe(8_000);
});

test("auto-compaction follows context size, with room for retained messages", () => {
  const settings = autoCompactionSettings([
    { provider: "or", id: "small", contextWindow: 8000 },
    { provider: "chatgpt", id: "large", contextWindow: 272000 },
  ]);
  expect(settings.enabled).toBe(true);
  expect(settings.reserveTokens).toBe(2000);
  expect(settings.modelOverrides["or/small"]).toEqual({ reserveTokens: 2000, keepRecentTokens: 800 });
  expect(settings.modelOverrides["chatgpt/large"]).toEqual({ reserveTokens: 68000, keepRecentTokens: 20000 });
  for (const contextWindow of [0, -1, NaN, Infinity])
    expect(() => autoCompactionSettings([{ provider: "or", id: "unknown", contextWindow }])).toThrow("unknown model context window");
});

test("assertExactTools disposes and throws on an unexpected tool set", () => {
  let disposed = 0;
  const session = (registered: string[], active = registered) => ({
    getAllTools: () => registered.map((name) => ({ name })),
    getActiveToolNames: () => active,
    dispose: () => void disposed++,
  });
  assertExactTools(session(["read", "edit"]), ["edit", "read"], "wiki-sync");
  expect(disposed).toBe(0);
  expect(() => assertExactTools(session(["read", "edit", "tool_search"]), ["edit", "read"], "wiki-sync")).toThrow("wiki-sync: unexpected pi tool set");
  expect(() => assertExactTools(session(["read", "edit"], ["read"]), ["edit", "read"], "wiki-sync")).toThrow("unexpected pi tool set");
  expect(disposed).toBe(2);
});
