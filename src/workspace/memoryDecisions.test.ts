import { expect, test } from "bun:test";
import { reviewMemoryDecisions, DEFAULT_MEMORY_REVIEW_MODEL, MemoryReviewError } from "./memoryDecisions.ts";
import { loadWorkspaceConfig } from "./config.ts";
import type { EndRunInput, RunRecorder } from "./runLog.ts";

const config = { apiKey: "test-key", baseUrl: "https://openrouter.ai/api/v1" };
const prompt = JSON.stringify({ today: "2026-10-14", items: [
  { id: "operation:0", change: { op: "upsert", text: "Avoids dairy.", kind: "fact" } },
  { id: "document:0", change: { path: "memory/topics/food.md", content: "Likes dairy." } },
], before: {}, documentsBefore: {}, sources: [{ id: "source", text: "I avoid dairy." }] });
function recorder() {
  const ends: EndRunInput[] = [];
  const runs: RunRecorder = { startRun: () => "test-run", endRun: (_id, result) => { ends.push(result); }, listRuns: () => [], getRun: () => null };
  return { runs, ends };
}
const response = (answers: unknown) => ({ model: "perplexity/pplx-decider-v1.1-27b-20261006", answers,
  usage: { input_tokens: 1000, output_tokens: 20, cost: 0.00002 } });
const mockFetch = (body: unknown, status = 200) => (async () => Response.json(body, { status })) as import("./memoryDecisions.ts").DecisionRequest;

test("native Decisions request covers operations and documents; policy and usage are host-owned", async () => {
  const { runs, ends } = recorder();
  const request = (async (url: URL, init: RequestInit) => {
    expect(String(url)).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(DEFAULT_MEMORY_REVIEW_MODEL);
    expect(body.state).toEqual(JSON.parse(prompt));
    expect(Object.keys(body.questions)).toEqual(["item_0", "item_1"]);
    expect(body.questions.item_0.type).toBe("noul");
    expect(body.questions.item_0.instructions).toContain("negation reversals");
    expect(body.questions.item_1.instructions).toContain("state.items[1]");
    expect(body.questions.item_0.instructions).not.toContain("Return JSON");
    return Response.json(response({ item_0: { type: "noul", noul: 0.90 }, item_1: { type: "noul", noul: 0.899 } }));
  }) as import("./memoryDecisions.ts").DecisionRequest;
  const result = await reviewMemoryDecisions(config, prompt, runs, request);
  expect(JSON.parse(result.text).decisions.map((d: any) => [d.id, d.verdict])).toEqual([
    ["operation:0", "supported"], ["document:0", "unsupported"],
  ]);
  expect(ends[0]?.usage?.costUsd).toBe(0.00002);
  expect(ends[0]?.usage?.model).toBe(result.model);
});

test.each([
  {},
  { item_0: { type: "noul", noul: 1 } },
  { item_0: { type: "noul", noul: 1 }, other: { type: "noul", noul: 1 } },
  { item_0: { type: "noul", noul: 1.1 }, item_1: { type: "noul", noul: 1 } },
  { item_0: { type: "noul", noul: "1" }, item_1: { type: "noul", noul: 1 } },
  { item_0: { type: "choice", choice: "yes" }, item_1: { type: "noul", noul: 1 } },
])("invalid answer set never approves", async answers => {
  const { runs, ends } = recorder();
  await expect(reviewMemoryDecisions(config, prompt, runs, mockFetch(response(answers)))).rejects.toThrow("no approval");
  expect(ends[0]?.status).toBe("failed");
});

test("HTTP failures and malformed JSON never fall back to chat or leak provider bodies", async () => {
  for (const request of [mockFetch({ error: "private-source-text" }, 429), (async () => new Response("{")) as import("./memoryDecisions.ts").DecisionRequest,
    (async () => { throw new Error("private-source-text"); }) as import("./memoryDecisions.ts").DecisionRequest]) {
    const { runs, ends } = recorder();
    await expect(reviewMemoryDecisions(config, prompt, runs, request)).rejects.toThrow("no approval");
    expect(JSON.stringify(ends)).not.toContain("private-source-text");
  }
});

test("model selection is independent of the chat provider and preserves a gateway URL", async () => {
  const loaded = loadWorkspaceConfig({ HOME: "/tmp/test", ORCH_SECRET: "test", OPENAI_API_KEY: "test", WORKSPACE_MEMORY_REVIEW_MODEL: "typesafe/jev-1.13" });
  expect(loaded.memoryReviewModel).toBe("typesafe/jev-1.13");
  expect(loadWorkspaceConfig({ HOME: "/tmp/test", ORCH_SECRET: "test", OPENAI_API_KEY: "test" }).memoryReviewModel).toBe(DEFAULT_MEMORY_REVIEW_MODEL);
  const { runs } = recorder();
  const request = (async (url: URL, init: RequestInit) => {
    expect(String(url)).toBe("https://gateway.example/router/alpha/decisions");
    expect(JSON.parse(init.body as string).model).toBe("typesafe/jev-1.13");
    return Response.json(response({ item_0: { type: "noul", noul: 1 }, item_1: { type: "noul", noul: 1 } }));
  }) as import("./memoryDecisions.ts").DecisionRequest;
  await reviewMemoryDecisions({ ...loaded, baseUrl: "https://gateway.example/router/v1/" }, prompt, runs, request);
});

test.each([
  ["http_404", mockFetch({ error: { message: "No endpoints found for private-source-text" } }, 404)],
  ["http_429", mockFetch({ error: "private-source-text" }, 429)],
  ["timeout", (async () => { throw new DOMException("private-source-text", "TimeoutError"); })],
  ["aborted", (async () => { throw new DOMException("private-source-text", "AbortError"); })],
  ["network", (async () => { throw new TypeError("fetch failed: private-source-text"); })],
  ["invalid_json", (async () => new Response("{private-source-text"))],
  ["schema_mismatch", mockFetch({ answers: { item_0: "private-source-text" } })],
  ["missing_answers", mockFetch(response({ item_0: { type: "noul", noul: 1 } }))],
] as [string, import("./memoryDecisions.ts").DecisionRequest][])("a failed review records only its safe class: %s", async (errorClass, request) => {
  const { runs, ends } = recorder();
  const error = await reviewMemoryDecisions(config, prompt, runs, request).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(MemoryReviewError);
  expect<string>((error as MemoryReviewError).errorClass).toBe(errorClass);
  expect((error as Error).message).toContain(`(${errorClass})`);
  expect(ends[0]).toMatchObject({ status: "failed" });
  expect(ends[0]!.resultSummary).toContain(`(${errorClass}, ${DEFAULT_MEMORY_REVIEW_MODEL})`);
  expect(JSON.stringify(ends) + (error as Error).message).not.toContain("private-source-text");
});
