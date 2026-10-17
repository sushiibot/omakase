import { Type } from "typebox";
import { mailManifest, toolPolicyManifest } from "../integrations/mail/manifest.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RPC_METHODS, type ToolCallParams, type ToolManifestEntry } from "../orchestration/contracts.ts";
import type { WorkspaceConfig } from "./config.ts";
import { BackendSelector } from "./chatgptFallback.ts";
import { ProactiveLimiter, createHeartbeatJob } from "./proactive.ts";
import { RunLog } from "./runLog.ts";
import { jobSessionDir } from "./sessionPaths.ts";
import { ToolStubs } from "./toolStubs.ts";
import { runToolFreeJob } from "./jobSession.ts";
import { MemoryEvidence } from "./memoryEvidence.ts";

// Real Pi 0.99.1 job sessions; the only fake is fetch.
const BASE = "http://openrouter.test/v1";
const AGENTS_MARKER = "AGENTS-MD-REACHES-THE-JOB";
const USER_MARKER = "USER-MD-REACHES-THE-JOB";
const MEMORY = "# MEMORY.md\n\n- Deploys from main. (src: 2026-09-10)\n";
const AUTH_SECRET = "refresh-token-must-not-leak";

type Reply = { text?: string; tool?: { name: string; args: object } };
type Body = { messages: Array<{ role: string; content: unknown }>; tools?: Array<{ function: { name: string } }> };

let root: string;
let bodies: Body[];
let script: Reply[];
const realFetch = globalThis.fetch;
const realKey = process.env.OPENAI_API_KEY;

function sse(reply: Reply, n: number): Response {
  const chunk = (delta: object, finish: string | null, extra: object = {}) =>
    `data: ${JSON.stringify({ id: "gen", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
  const delta = reply.tool
    ? { role: "assistant", tool_calls: [{ index: 0, id: `call_${n}`, type: "function", function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) } }] }
    : { role: "assistant", content: reply.text ?? "" };
  const body = chunk(delta, null) + chunk({}, reply.tool ? "tool_calls" : "stop", { usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }) + "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

const toolNames = (b: Body) => (b.tools ?? []).map((t) => t.function.name).sort();

function config(): WorkspaceConfig {
  return {
    provider: "openrouter",
    chatgptModel: "gpt-6.1-sol",
    model: "openai/gpt-6-luna",
    apiKey: "test-openrouter-key",
    baseUrl: BASE,
    agentDir: join(root, "agent"),
    home: join(root, "home"),
    stateDir: join(root, "state"),
    principalId: "drk",
    tz: "UTC",
    consolidateAt: "04:00",
    heartbeat: { when: { kind: "every", minutes: 120 } },
    proactiveDailyCap: 6,
  } as WorkspaceConfig;
}

const SEARCH: ToolManifestEntry = {
  name: "web_search",
  description: "Search the web.",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
  approval: "none",
};

const LINEAR: ToolManifestEntry = {
  name: "file_linear_issue",
  description: "File a Linear issue.",
  inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false },
  approval: "ask",
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ws-proactive-pi-"));
  bodies = [];
  script = [];
  delete process.env.OPENAI_API_KEY;
  mkdirSync(join(root, "agent"), { recursive: true });
  writeFileSync(join(root, "agent", "auth.json"), JSON.stringify({ openrouter: { key: AUTH_SECRET } }));
  const home = join(root, "home");
  mkdirSync(join(home, "memory"), { recursive: true });
  writeFileSync(join(home, "AGENTS.md"), `# AGENTS\n${AGENTS_MARKER}\n`);
  writeFileSync(join(home, "USER.md"), `# USER\n${USER_MARKER}\n`);
  writeFileSync(join(home, "MEMORY.md"), MEMORY);
  writeFileSync(join(home, "memory", "2026-09-29.md"), "- drk is waiting on a deploy\n");
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://openrouter.ai/api/v1/models")) return new Response("", { status: 503 });
    if (!url.startsWith(`${BASE}/chat/completions`)) throw new Error(`unexpected fetch in test: ${url}`);
    bodies.push(JSON.parse(String(init?.body ?? "{}")) as Body);
    return sse(script[bodies.length - 1] ?? { text: "NO_REPLY" }, bodies.length);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = realKey;
  rmSync(root, { recursive: true, force: true });
});

describe("heartbeat on a real Pi session", () => {
  test("tool-free jobs do not receive codemode", async () => {
    const cfg = config();
    script = [{ text: "done" }];
    await runToolFreeJob(cfg, { agentName: "job:transform", systemPrompt: "Transform text.", prompt: "Summarize.",
      runs: new RunLog(cfg.stateDir), selector: new BackendSelector({ primaryEnabled: false }),
    });
    expect(toolNames(bodies[0]!)).toEqual([]);
  });

  test("codemode batches permitted reads but cannot reach writes, gated stubs or credentials", async () => {
    const cfg = config();
    const calls: string[] = [];
    const stubs = new ToolStubs({ principalId: "drk", request: async (_method, params) => {
      calls.push((params as ToolCallParams).name);
      return { ok: true, result: "search hits" };
    } });
    stubs.update([SEARCH, LINEAR, ...mailManifest]);
    script = [
      { tool: { name: "codemode", args: { code: `
        const results = await Promise.allSettled([
          tools.read({path: "MEMORY.md"}),
          tools.web_search({query: "deploy"}),
          tools.read({path: ${JSON.stringify(join(cfg.agentDir, "auth.json"))}})
        ]);
        text(results);
        text({write: "write" in tools, bash: "bash" in tools, gated: "file_linear_issue" in tools, models: typeof models, draft: "mail_save_draft" in tools});
      ` } } },
      { text: "NO_REPLY" },
    ];
    await runToolFreeJob(cfg, { agentName: "job:heartbeat", systemPrompt: "Check sources.", prompt: "Check.",
      runs: new RunLog(cfg.stateDir), selector: new BackendSelector({ primaryEnabled: false }), readOnlyTools: { toolStubs: stubs },
    });
    const results = bodies.at(-1)!.messages.filter(m => m.role === "tool").map(m => String(m.content)).join("\n");
    expect(results).toContain("search hits");
    expect(results).toContain("Deploys from main");
    expect(results).toContain("rejected");
    expect(results).not.toContain(AUTH_SECRET);
    expect(results).toContain('{"write":false,"bash":false,"gated":false,"models":"undefined","draft":false}');
    expect(results).toContain("Script completed");
    expect(calls).toEqual(["web_search"]);
    expect(readFileSync(join(cfg.home, "MEMORY.md"), "utf8")).toBe(MEMORY);
  });

  test("dreaming searches full source evidence through read-only tools and cannot rewrite conversations", async () => {
    const cfg = config();
    mkdirSync(join(cfg.agentDir, "chat"), { recursive: true });
    const source = join(cfg.agentDir, "chat/grocery.jsonl");
    const original = [
      { type: "session" },
      { type: "message", timestamp: "2026-10-12T10:00:00Z", message: { role: "toolResult", toolName: "browser", content: "Whole Foods: butter beans 2 cans, cannellini beans 1 can." } },
    ].map(e => JSON.stringify(e)).join("\n") + "\n";
    writeFileSync(source, original);
    const evidence = new MemoryEvidence(cfg.home, cfg.agentDir);
    try {
      await evidence.refresh();
      const id = evidence.search("cannellini").results[0]!.id;
      const reads = new Map();
      script = [
        { tool: { name: "write", args: { path: source, content: "overwritten" } } },
        { tool: { name: "bash", args: { command: `rm '${source}'` } } },
        { tool: { name: "read", args: { path: join(cfg.agentDir, "auth.json") } } },
        { tool: { name: "memory_search", args: { query: "cannellini" } } },
        { tool: { name: "memory_read", args: { id } } },
        { text: "Investigated the historical order." },
      ];
      await runToolFreeJob(cfg, { agentName: "job:consolidation", systemPrompt: "Investigate memory with read-only tools.", prompt: "Check the order.",
        runs: new RunLog(cfg.stateDir), selector: new BackendSelector({ primaryEnabled: false }), readOnlyTools: {}, evidenceTools: evidence.tools(reads),
      });
      for (const body of bodies) expect(toolNames(body)).toEqual(["codemode", "find", "grep", "ls", "memory_read", "memory_search", "read"]);
      expect(readFileSync(source, "utf8")).toBe(original);
      expect(reads.get(id)?.text).toContain("cannellini beans 1 can");
      const result = JSON.stringify(bodies.at(-1)!.messages);
      expect(result).toContain("Tool write not found");
      expect(result).toContain("Tool bash not found");
      expect(result).toContain("Blocked by the secret guard");
      expect(result).not.toContain(AUTH_SECRET);
    } finally { evidence.close(); }
  });
  test("read-only tools only: no bash, no memory writes, no credential reads; stubs run as job:heartbeat; logged and delivered", async () => {
    const cfg = config();
    const runs = new RunLog(cfg.stateDir);
    const toolCalls: ToolCallParams[] = [];
    const toolStubs = new ToolStubs({
      principalId: "drk",
      request: async (method, params) => {
        if (method === RPC_METHODS.toolCall) toolCalls.push(params as ToolCallParams);
        return { ok: true, result: "search hits" };
      },
    });
    // Approval-gated stubs stay out of jobs even though the bot offers them.
    toolStubs.update([SEARCH, LINEAR]);
    const delivered: string[] = [];
    const notes: string[] = [];
    script = [
      { tool: { name: "write", args: { path: "MEMORY.md", content: "overwritten" } } },
      { tool: { name: "edit", args: { path: "MEMORY.md", edits: [{ oldText: "Deploys", newText: "Ships" }] } } },
      { tool: { name: "bash", args: { command: "echo pwned >> MEMORY.md" } } },
      { tool: { name: "read", args: { path: join(root, "agent", "auth.json") } } },
      { tool: { name: "web_search", args: { query: "deploy status" } } },
      { text: "The deploy drk is waiting on has failed." },
    ];

    const outcome = await createHeartbeatJob(cfg.heartbeat!, {
      config: cfg,
      runs,
      selector: new BackendSelector({ primaryEnabled: cfg.provider === "chatgpt" }),
      toolStubs,
      limiter: new ProactiveLimiter(cfg.stateDir, cfg.proactiveDailyCap),
      deliver: (t) => delivered.push(t),
      note: async (_name, t) => {
        notes.push(t);
      },
    }).run({ trigger: "interval", force: false });

    expect(outcome.status).toBe("sent");
    expect(bodies).toHaveLength(6);
    for (const b of bodies) expect(toolNames(b)).toEqual(["codemode", "find", "grep", "ls", "read", "web_search"]);
    expect(readFileSync(join(cfg.home, "MEMORY.md"), "utf8")).toBe(MEMORY);
    expect(JSON.stringify(bodies.at(-1)!.messages)).not.toContain(AUTH_SECRET);
    const results = bodies.at(-1)!.messages.filter((m) => m.role === "tool").map((m) => JSON.stringify(m.content));
    expect(results.slice(0, 3)).toEqual(['"Tool write not found"', '"Tool edit not found"', '"Tool bash not found"']);
    expect(results[3]).toContain("Blocked by the secret guard");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({ name: "web_search", agentId: "job:heartbeat", agentName: "job:heartbeat" });

    const system = String(bodies[0]!.messages[0]!.content);
    expect(system).toContain('scheduled job "heartbeat"');
    expect(system).toContain(AGENTS_MARKER);
    expect(system).toContain(USER_MARKER);
    expect(JSON.stringify(bodies[0])).not.toContain("Deploys from main");
    expect(JSON.stringify(bodies[0]!.messages.at(-1))).toContain("drk is waiting on a deploy");

    expect(delivered).toEqual(["The deploy drk is waiting on has failed."]);
    expect(notes).toHaveLength(1);
    const [run] = runs.listRuns({ agentName: "job:heartbeat" });
    expect(run).toMatchObject({ agentName: "job:heartbeat", status: "done" });
    expect(run!.sessionFile.startsWith(`${jobSessionDir(cfg.agentDir)}/`)).toBe(true);
    expect(existsSync(run!.sessionFile)).toBe(true);
    // The job's stub binding is released with its session.
    expect((toolStubs as unknown as { bindings: Set<unknown> }).bindings.size).toBe(0);
  });

  test("NO_REPLY on a real session: nothing delivered, run still logged", async () => {
    const cfg = config();
    const runs = new RunLog(cfg.stateDir);
    const delivered: string[] = [];
    script = [{ text: "NO_REPLY" }];
    const outcome = await createHeartbeatJob(cfg.heartbeat!, {
      config: cfg,
      runs,
      selector: new BackendSelector({ primaryEnabled: cfg.provider === "chatgpt" }),
      limiter: new ProactiveLimiter(cfg.stateDir, cfg.proactiveDailyCap),
      deliver: (t) => delivered.push(t),
      note: async () => {},
    }).run({ trigger: "interval", force: false });
    const [run] = runs.listRuns({ agentName: "job:heartbeat" });
    expect(outcome).toEqual({ status: "no_reply", runId: run!.runId });
    expect(delivered).toEqual([]);
    expect(toolNames(bodies[0]!)).toEqual(["codemode", "find", "grep", "ls", "read"]);
    expect(run).toMatchObject({ status: "done" });
  });
});

for (const decision of ["allow", "ask"] as const) {
  test(`scheduled MCP calls use per-call review and ${decision === "ask" ? "block requests needing approval" : "allow reviewed reads"}`, async () => {
    const cfg = config();
    let executed = 0;
    const stubs = new ToolStubs({ principalId: "drk", request: async () => ({ok: true, result: JSON.stringify({rules: "Read only; no notifications"})}) });
    stubs.update([toolPolicyManifest]);
    script = [
      {tool: {name: "mcp_call_tool", args: {serverId: "mail", tool: "search", arguments: {query: "tenant"}}}},
      {text: `<verdict>${decision}</verdict> reviewed action`},
      {text: "NO_REPLY"},
    ];
    await runToolFreeJob(cfg, {
      agentName: "job:heartbeat", systemPrompt: "Read connected sources.", prompt: "Check tenant mail.",
      runs: new RunLog(cfg.stateDir), selector: new BackendSelector({primaryEnabled: false}), readOnlyTools: {toolStubs: stubs},
      describeMcpCall: async () => ({description: "Search mail without changing it"}),
      evidenceTools: [{ name: "mcp_call_tool", label: "MCP", description: "Call MCP", parameters: Type.Object({serverId: Type.String(), tool: Type.String(), arguments: Type.Record(Type.String(), Type.Unknown())}), execute: async () => { executed++; return {content: [{type: "text", text: "mail result"}], details: {}}; } }],
    });
    expect(executed).toBe(decision === "allow" ? 1 : 0);
    expect(JSON.stringify(bodies[1])).toContain("Read only; no notifications");
    expect(JSON.stringify(bodies[1])).toContain("Search mail without changing it");
    expect(JSON.stringify(bodies[1])).toContain("tenant");
  });
}
