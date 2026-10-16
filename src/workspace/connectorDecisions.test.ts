import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectorDecisions } from "./connectorDecisions.ts";
import type { EndRunInput, RunRecorder } from "./runLog.ts";
import type { DecisionRequest } from "./memoryDecisions.ts";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
const server = { id: "mail", url: "https://mail.example/mcp" };
const tool = { name: "search", description: "Search existing mail without marking read", inputSchema: { type: "object" as const } };
function setup(request: DecisionRequest) {
  const agentDir = mkdtempSync(join(tmpdir(), "connector-decisions-")); dirs.push(agentDir);
  const config = { agentDir, apiKey: "secret", baseUrl: "https://gateway.example/router/v1/" };
  const ends: EndRunInput[] = [];
  const runs: RunRecorder = { startRun: () => "review", endRun: (_id, r) => { ends.push(r); }, listRuns: () => [], getRun: () => null };
  return { classifier: new ConnectorDecisions(config, runs, request), config, runs, ends };
}
const answer = (score: number) => Response.json({ model: "decider", answers: { tool_0: { type: "noul", noul: score } } });

test("classifies descriptors without executing tools; caches across restart and invalidates changed definitions", async () => {
  let calls = 0;
  const request: DecisionRequest = async (url, init) => {
    calls++;
    expect(String(url)).toBe("https://gateway.example/router/alpha/decisions");
    expect(init.redirect).toBe("error");
    const body = JSON.parse(init.body as string);
    expect(body.state.tools).toHaveLength(1);
    expect(body.questions.tool_0.instructions).toContain("every supported argument");
    expect(body.questions.tool_0.instructions).toContain("untrusted data");
    return answer(calls === 1 ? 0.99 : 0.2);
  };
  const s = setup(request);
  expect(await s.classifier.classify(server, [tool])).toEqual(new Set(["search"]));
  const restarted = new ConnectorDecisions(s.config, s.runs, request);
  expect(await restarted.classify(server, [tool])).toEqual(new Set(["search"]));
  expect(calls).toBe(1);
  expect(await restarted.classify(server, [{ ...tool, description: "Search and mark messages read" }])).toEqual(new Set());
  expect(calls).toBe(2);
  expect(await restarted.classify({ ...server, id: "replacement" }, [tool])).toEqual(new Set());
  expect(calls).toBe(3);
});

test("annotations bypass inference; ambiguous scores remain excluded", async () => {
  let calls = 0;
  const s = setup(async () => { calls++; return answer(0.94); });
  expect(await s.classifier.classify(server, [{ ...tool, annotations: { readOnlyHint: false } }, { ...tool, annotations: { readOnlyHint: true } }])).toEqual(new Set());
  expect(calls).toBe(0);
  expect(await s.classifier.classify(server, [tool])).toEqual(new Set());
});

test.each([
  { answers: {} },
  { answers: { tool_0: { type: "noul", noul: 1 }, extra: { type: "noul", noul: 1 } } },
  { answers: { tool_0: { type: "noul", noul: "1" } } },
  { answers: { tool_0: { type: "noul", noul: 1.01 } } },
])("malformed decisions exclude tools and do not cache approval", async body => {
  const s = setup(async () => Response.json({ model: "decider", ...body }));
  expect(await s.classifier.classify(server, [tool])).toEqual(new Set());
  expect(s.ends[0]?.status).toBe("failed");
});

test("request failure excludes tools, records no private provider error, and retries next scan", async () => {
  let calls = 0;
  const s = setup(async () => { if (++calls === 1) throw new Error("private provider text"); return answer(1); });
  expect(await s.classifier.classify(server, [tool])).toEqual(new Set());
  expect(JSON.stringify(s.ends)).not.toContain("private provider text");
  expect(await s.classifier.classify(server, [tool])).toEqual(new Set(["search"]));
});

test("large inventories use bounded batches; concurrent discovery shares cached assessments", async () => {
  const sizes: number[] = [];
  const s = setup(async (_url, init) => {
    const body = JSON.parse(init.body as string);
    sizes.push(body.state.tools.length);
    return Response.json({ model: "decider", answers: Object.fromEntries(Object.keys(body.questions).map(k => [k, { type: "noul", noul: 1 }])) });
  });
  const tools = Array.from({ length: 51 }, (_, i) => ({ ...tool, name: `search_${i}` }));
  const results = await Promise.all([s.classifier.classify(server, tools), s.classifier.classify(server, tools)]);
  expect(results.map(r => r.size)).toEqual([51, 51]);
  expect(sizes).toEqual([50, 1]);
});
