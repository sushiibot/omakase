import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceConfig } from "./config.ts";
import { BackendSelector } from "./chatgptFallback.ts";
import { CONSOLIDATION_AGENT, systemPrompt, createConsolidationJob } from "./consolidation.ts";
import { memoryEntries, memorySources, MEMORY_REVIEW_RULES } from "./memoryUpdates.ts";
import { commitHome, scaffoldHome } from "./home.ts";
import { runToolFreeJob } from "./jobSession.ts";
import { RunLog } from "./runLog.ts";
import { jobSessionDir } from "./sessionPaths.ts";

// Real Pi 0.99.1 job sessions; the only fake is fetch.
const OPENROUTER_BASE = "http://openrouter.test/v1";
const OPENROUTER_MODEL = "openai/gpt-6-luna";
const USAGE_LIMIT_BODY = { error: { code: "subscription_sharing_usage_limit_exceeded", type: "usage_limit_reached", message: "usage limit reached" } };
const GIT_ENV = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const AGENTS_MARKER = "AGENTS-MD-MUST-NOT-REACH-THE-JOB";

type Body = { messages: Array<{ role: string; content: unknown }>; tools?: unknown[] };

let root: string;
let requests: string[];
let bodies: Body[];
let decisionBodies: any[];
const realFetch = globalThis.fetch;
const realKey = process.env.OPENAI_API_KEY;
const savedEnv: Record<string, string | undefined> = {};

const isChatGpt = (url: string) => url.startsWith("https://api.openai.com/");
const isDecision = (url: string) => url === "http://openrouter.test/alpha/decisions";
const isOpenRouter = (url: string) => url.startsWith(`${OPENROUTER_BASE}/chat/completions`);

function stubFetch(handler: (url: string) => Response | undefined): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    if (isDecision(url)) decisionBodies.push(JSON.parse(String(init?.body)));
    if (isOpenRouter(url)) bodies.push(JSON.parse(String(init?.body ?? (input instanceof Request ? await input.text() : "{}"))));
    if (url.startsWith("https://openrouter.ai/api/v1/models")) return new Response("", { status: 503 });
    const response = handler(url);
    if (!response) throw new Error(`unexpected fetch in test: ${url}`);
    return response;
  }) as unknown as typeof fetch;
}

function openRouterReply(text: string): Response {
  const chunk = (delta: object, finish: string | null, extra: object = {}) =>
    `data: ${JSON.stringify({ id: "gen-1", object: "chat.completion.chunk", created: 1, model: OPENROUTER_MODEL, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
  const body = chunk({ role: "assistant", content: text }, null) + chunk({}, "stop", { usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }) + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function signInChatGpt(): void {
  writeFileSync(
    join(root, "agent", "auth.json"),
    JSON.stringify({
      openai: { type: "oauth", access: "a", refresh: "r", expires: Date.now() + 24 * 3_600_000, clientId: "c", scopes: ["chatgpt.tokens.use.direct"] },
    }),
  );
}

function config(provider: "chatgpt" | "openrouter" = "chatgpt"): WorkspaceConfig {
  return {
    provider,
    chatgptModel: "gpt-6.1-sol",
    model: OPENROUTER_MODEL,
    apiKey: "test-openrouter-key",
    baseUrl: OPENROUTER_BASE,
    agentDir: join(root, "agent"),
    home: join(root, "home"),
    stateDir: join(root, "state"),
    tz: "UTC",
    consolidateAt: "04:00",
  } as WorkspaceConfig;
}

const USER = "# USER.md\n\n- Prefers metric units. (src: 2026-09-01, discord:111)\n";
const MEMORY = "# MEMORY.md\n\n- Deploys on push to main. (src: 2026-09-02, discord:222)\n- Deploys from main via CI. (src: 2026-09-10, discord:333)\n";
const NOTE_TEXT = `- Started using uv for Python.\n${"- worked on the workspace\n".repeat(100)}`;
const NEW_MEMORY = "# MEMORY.md\n- Deploys from main via CI on every push. (src: 2026-09-10, discord:333) (src: 2026-09-02, discord:222)\n- Uses uv for Python. (src: 2026-09-28)\n";
const entries = memoryEntries({ "USER.md": USER, "MEMORY.md": MEMORY }).filter(e => e.file === "MEMORY.md");
const noteId = [...memorySources({ "USER.md": USER, "MEMORY.md": MEMORY }, [{ file: "2026-09-28.md", date: "2026-09-28", text: NOTE_TEXT, endOffset: NOTE_TEXT.length }], new Map()).keys()].find(id => id.startsWith("note-"))!;
const PROPOSAL = JSON.stringify({ operations: [
  { op: "remove", id: entries[0]!.id, reason: "merged duplicate deployment information", sources: [entries[1]!.id] },
  { op: "upsert", id: entries[1]!.id, file: "MEMORY.md", text: "Deploys from main via CI on every push.", kind: "fact", sources: [entries[1]!.id, entries[0]!.id] },
  { op: "upsert", file: "MEMORY.md", text: "Uses uv for Python.", kind: "fact", sources: [noteId] },
], documents: [], summary: "merged deploy entries" });
const REVIEW = { model: "perplexity/pplx-decider-v1.2", answers: Object.fromEntries([0, 1, 2].map(i => [`item_${i}`, { type: "noul", noul: 0.99 }])), usage: { input_tokens: 100, output_tokens: 3, cost: 0.000002 } };

beforeAll(() => {
  for (const [k, v] of Object.entries(GIT_ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
});

afterAll(() => {
  for (const k of Object.keys(GIT_ENV)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "ws-consolidate-pi-"));
  requests = [];
  bodies = [];
  decisionBodies = [];
  delete process.env.OPENAI_API_KEY;
  mkdirSync(join(root, "agent"), { recursive: true });
  const home = join(root, "home");
  await scaffoldHome(home);
  writeFileSync(join(home, "AGENTS.md"), `# AGENTS\n${AGENTS_MARKER}\n`);
  writeFileSync(join(home, "USER.md"), USER);
  writeFileSync(join(home, "MEMORY.md"), MEMORY);
  writeFileSync(join(home, "memory", "2026-09-28.md"), NOTE_TEXT);
  await commitHome("seed", { home });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = realKey;
  rmSync(root, { recursive: true, force: true });
});

describe("consolidation job on a real Pi session", () => {
  test("ChatGPT limit → OpenRouter retry; read-only evidence tools on the wire; applied; logged as job:consolidation", async () => {
    signInChatGpt();
    stubFetch((url) => (isChatGpt(url) ? jsonResponse(429, USAGE_LIMIT_BODY) : isOpenRouter(url) ? openRouterReply(PROPOSAL) : isDecision(url) ? jsonResponse(200, REVIEW) : undefined));
    const runs = new RunLog(config().stateDir);

    const outcome = await createConsolidationJob(config(), { runs, selector: new BackendSelector({ primaryEnabled: config().provider === "chatgpt" }) }).run({ trigger: "manual", force: false });

    expect(outcome.status).toBe("applied");
    expect(requests.filter(isChatGpt)).toHaveLength(1);
    expect(requests.filter(isOpenRouter)).toHaveLength(1);
    expect(requests.filter(isDecision)).toHaveLength(1);
    expect(decisionBodies[0].model).toBe(REVIEW.model);
    expect(decisionBodies[0].questions.item_0.type).toBe("noul");
    expect(decisionBodies[0].questions.item_0.instructions).toContain(MEMORY_REVIEW_RULES);
    expect(decisionBodies[0].state.items).toHaveLength(3);
    expect(runs.listRuns({ agentName: "job:memory-review" })[0]).toMatchObject({ status: "done" });
    const body = bodies[0]!;
    expect((body.tools ?? []).map(t => (t as { function: { name: string } }).function.name).sort()).toEqual(["codemode", "find", "grep", "ls", "memory_read", "memory_search", "read"]);
    const system = JSON.stringify(body.messages.filter((m) => m.role === "system"));
    expect(system).toContain(systemPrompt().slice(0, 60));
    expect(JSON.stringify(body)).not.toContain(AGENTS_MARKER);
    expect(JSON.stringify(body.messages.at(-1))).toContain("Started using uv for Python");

    expect(readFileSync(join(root, "home", "MEMORY.md"), "utf8")).toBe(NEW_MEMORY);
    expect(readFileSync(join(root, "home", "DREAMS.md"), "utf8")).toContain(`- Model: ${OPENROUTER_MODEL}`);

    const [run] = runs.listRuns({ agentName: CONSOLIDATION_AGENT });
    expect(run).toMatchObject({ agentName: "job:consolidation", status: "done" });
    expect(run!.task).toContain("Return only a JSON object");
    expect(run!.sessionFile.startsWith(`${jobSessionDir(config().agentDir)}/`)).toBe(true);
    expect(existsSync(run!.sessionFile)).toBe(true);
  });

  test("the job session registers no tools, even with the OpenRouter-only backend", async () => {
    stubFetch((url) => (isOpenRouter(url) ? openRouterReply("done") : undefined));
    const runs = new RunLog(config("openrouter").stateDir);
    const result = await runToolFreeJob(config("openrouter"), { agentName: "job:test", systemPrompt: "Reply done.", prompt: "go", runs, selector: new BackendSelector({ primaryEnabled: false }) });
    expect(result).toMatchObject({ text: "done", model: OPENROUTER_MODEL });
    expect(bodies[0]!.tools ?? []).toEqual([]);
    // Pi appends only a <cwd> block to the override; none of its coding-agent prompt or tool docs.
    const system = bodies[0]!.messages[0]!;
    expect(system.role).toBe("system");
    expect(String(system.content).startsWith("Reply done.\n")).toBe(true);
    expect(String(system.content)).not.toMatch(/bash|Available tools/i);
  });

  test("a model error fails the job, records a failed run, and leaves memory alone", async () => {
    stubFetch((url) => (isOpenRouter(url) ? jsonResponse(400, { error: { message: "bad request", code: 400 } }) : undefined));
    const runs = new RunLog(config("openrouter").stateDir);
    await expect(createConsolidationJob(config("openrouter"), { runs, selector: new BackendSelector({ primaryEnabled: false }) }).run({ trigger: "daily", force: false })).rejects.toThrow(/job reply error/);
    expect(runs.listRuns({ agentName: CONSOLIDATION_AGENT })[0]).toMatchObject({ status: "failed" });
    expect(readFileSync(join(root, "home", "MEMORY.md"), "utf8")).toBe(MEMORY);
  });
});
