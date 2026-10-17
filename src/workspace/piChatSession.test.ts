import { clearOpenRouterCatalog } from "../agentRuntime/piShared.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { WorkspaceConfig } from "./config.ts";
import { createPiChatSessionFactory, createWorkspaceBashTool, currentRunId, reloadContext } from "./piChatSession.ts";
import { RunLog } from "./runLog.ts";
import { runWsRuns } from "./wsRuns.ts";
import { ChatAsks, createHeadlessUIContext } from "./uiContext.ts";
import { OwnerRequests } from "./ownerRequests.ts";
import { WakeupManager } from "./wakeups.ts";

let root: string;
const realFetch = globalThis.fetch;

beforeEach(() => {
  clearOpenRouterCatalog();
  root = mkdtempSync(join(tmpdir(), "ws-pichat-"));
  // No network: the fixture declares its context window in a fake model catalog.
  globalThis.fetch = (async (input: RequestInfo | URL) => String(input).includes("/models") ? Response.json({ data: [{ id: "test/model", context_length: 800000 }] }) : new Response("", { status: 503 })) as unknown as typeof fetch;
});
afterEach(() => {
  clearOpenRouterCatalog();
  globalThis.fetch = realFetch;
  rmSync(root, { recursive: true, force: true });
});

function testConfig(): WorkspaceConfig {
  return {
    model: "test/model",
    apiKey: "test-key",
    baseUrl: "http://127.0.0.1:9/v1",
    agentDir: join(root, "agent"),
    home: join(root, "home"),
    stateDir: join(root, "state"),
  } as WorkspaceConfig;
}

async function realSession(): Promise<AgentSession> {
  const { session } = await createPiChatSessionFactory(testConfig())({ sessionFile: null });
  return session as AgentSession;
}

test("scheduled-check tools remain available in real Pi main and topic sessions after reload", async () => {
  const config = testConfig();
  const wakeups = new WakeupManager({ stateDir: config.stateDir, timeZone: "UTC", conversationExists: () => true, deliver: async () => {} });
  for (const conversationId of ["main", "trip"]) {
    const built = await createPiChatSessionFactory(config, { wakeups, origin: { surface: "web", conversationId } })({ sessionFile: null });
    const session = built.session as AgentSession;
    try {
      for (const name of ["codemode", "schedule_check", "list_scheduled_checks", "reschedule_check", "cancel_scheduled_check"])
        expect(session.getActiveToolNames()).toContain(name);
      await reloadContext(session);
      expect(session.getActiveToolNames()).toContain("schedule_check");
      expect(session.getActiveToolNames()).toContain("codemode");
      const tool = session.getToolDefinition("schedule_check")!;
      const result = await tool.execute("check", { key: "status", title: "Status", prompt: "Check status", at: "2099-01-01T10:00:00Z" }, undefined, undefined, {} as never);
      const check = JSON.parse(result.content.map(c => "text" in c ? c.text : "").join(""));
      expect(check.check.conversationId).toBe(conversationId);
    } finally { session.dispose(); }
  }
});

describe("run log", () => {
  test("a real chat turn is recorded as a main run in the run index", async () => {
    const config = testConfig();
    const runs = new RunLog(config.stateDir);
    // No retries against the unreachable model, so the turn fails fast.
    mkdirSync(config.agentDir, { recursive: true });
    writeFileSync(join(config.agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false } }));
    const built = await createPiChatSessionFactory(config, { runs })({ sessionFile: null });
    const { session, sessionFile } = built;
    expect(sessionFile.startsWith(join(config.agentDir, "chat"))).toBe(true);
    const midRun: (string | null)[] = [];
    (session as AgentSession).subscribe((e) => {
      if (e.type === "message_start") midRun.push(built.currentRunId?.() ?? null);
    });
    await (session as AgentSession).prompt("hello there").catch(() => {});
    const [run] = runs.listRuns();
    expect(run).toMatchObject({ agentName: "main", task: "hello there", sessionFile, status: "failed" });
    expect(run.endedAt).toBeDefined();
    expect(midRun).toContain(run.runId);
    expect(built.currentRunId?.()).toBeNull();

    // ws-runs reads the real Pi session file for that run.
    const out: string[] = [];
    const env = { HOME: config.home, WORKSPACE_STATE_DIR: config.stateDir, PI_CODING_AGENT_DIR: config.agentDir };
    expect(runWsRuns(["show", run.runId], { env, agentDirs: [config.agentDir], out: (l) => out.push(l), err: (l) => out.push(l) })).toBe(0);
    expect(out.join("\n")).toContain("user: hello there");
    expect(out.join("\n")).toContain("[error: 503");
    expect(currentRunId(session)).toBeNull();
    session.dispose();
  }, 20_000);

  test("the agent's bash sees the run in progress as WS_RUN_ID, read per spawn", async () => {
    let runId: string | null = "01RUNA";
    const tool = await createWorkspaceBashTool(root, () => runId);
    const echo = async () => {
      const result = await tool.execute("t", { command: 'echo "id=$WS_RUN_ID"' }, undefined, undefined, {} as never);
      return result.content.map((c) => ("text" in c ? c.text : "")).join("").trim();
    };
    expect(await echo()).toBe("id=01RUNA");
    runId = "01RUNB";
    expect(await echo()).toBe("id=01RUNB");
    runId = null;
    expect(await echo()).toBe("id=");
  });
});

describe("reloadContext", () => {
  test("bash receives the custom Maps socket without inheriting the Google key", async () => {
    const before = process.env.GOOGLE_MAPS_API_KEY;
    process.env.GOOGLE_MAPS_API_KEY = "must-not-reach-shell";
    try {
      const tool = await createWorkspaceBashTool(root, () => null, undefined, undefined, root);
      const result = await tool.execute("t", { command: 'printf "%s|%s" "$MAPS_SOCKET" "$GOOGLE_MAPS_API_KEY"' }, undefined, undefined, {} as never);
      expect(result.content.map(c => "text" in c ? c.text : "").join("").trim()).toBe(`${root}/maps.sock|`);
    } finally {
      if (before === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
      else process.env.GOOGLE_MAPS_API_KEY = before;
    }
  });
  test("auto-compaction stays enabled despite disabled disk settings, including after reload", async () => {
    const config = testConfig();
    mkdirSync(config.agentDir, { recursive: true });
    writeFileSync(join(config.agentDir, "settings.json"), JSON.stringify({ compaction: { enabled: false } }));
    const session = await realSession();
    try {
      expect(session.settingsManager.getCompactionSettings(session.model).enabled).toBe(true);
      await reloadContext(session);
      expect(session.settingsManager.getCompactionSettings(session.model).enabled).toBe(true);
    } finally { session.dispose(); }
  });

  test("keeps the compaction reserve override across a reload", async () => {
    const session = await realSession();
    const reserve = session.settingsManager.getCompactionSettings().reserveTokens;
    expect(reserve).toBeGreaterThan(16_384);
    await reloadContext(session);
    expect(session.settingsManager.getCompactionSettings().reserveTokens).toBe(reserve);
    session.dispose();
  });

  test("re-applies the override even when the reload fails midway", async () => {
    const session = await realSession();
    const reserve = session.settingsManager.getCompactionSettings().reserveTokens;
    session.reload = async () => {
      await session.settingsManager.reload();
      throw new Error("resource reload failed");
    };
    await expect(reloadContext(session)).rejects.toThrow("resource reload failed");
    expect(session.settingsManager.getCompactionSettings().reserveTokens).toBe(reserve);
    session.dispose();
  });
});

describe("extensions", () => {
  test("a failed input checkpoint blocks a real Pi bash call", async () => {
    const config = testConfig();
    mkdirSync(config.home, { recursive: true });
    const marker = join(config.home, "should-not-exist");
    let calls = 0;
    let fences = 0;
    const chunk = (delta: object, finish: string | null) => `data: ${JSON.stringify({ id: "gen", object: "chat.completion.chunk", created: 1, model: "test/model", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/models")) return Response.json({ data: [{ id: "test/model", context_length: 800000 }] });
      calls++;
      if (calls === 1) return new Response(chunk({ role: "assistant", tool_calls: [{ index: 0, id: "blocked-bash", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: `touch ${marker}` }) } }] }, null) + chunk({}, "tool_calls") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
      expect(String(init?.body)).toContain("input checkpoint could not be saved");
      return new Response(chunk({ role: "assistant", content: "Tool was blocked." }, null) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const { session } = await createPiChatSessionFactory(config)({
      sessionFile: null,
      checkpoint: async () => { fences++; throw new Error("checkpoint unavailable"); },
    });
    try {
      await session.prompt("Create the marker.");
      expect(calls).toBe(2);
      expect(fences).toBeGreaterThanOrEqual(3);
      expect(existsSync(marker)).toBe(false);
    } finally { session.dispose(); }
  });

  // Pi would load these from the agent dir and from the project (<cwd>/.pi); the agent can write both.
  function plantExtensions(config: WorkspaceConfig): string[] {
    const markers: string[] = [];
    for (const dir of [join(config.agentDir, "extensions"), join(config.home, ".pi", "extensions")]) {
      mkdirSync(dir, { recursive: true });
      const marker = join(dir, "loaded.marker");
      markers.push(marker);
      writeFileSync(
        join(dir, "planted.ts"),
        `import { writeFileSync } from "node:fs";\nexport default function () { writeFileSync(${JSON.stringify(marker)}, "loaded"); }\n`,
      );
    }
    return markers;
  }

  test("auto-discovered extensions are not loaded, at creation, reload, or a new session", async () => {
    const config = testConfig();
    const markers = plantExtensions(config);
    const factory = createPiChatSessionFactory(config);
    const { session } = await factory({ sessionFile: null });
    const planted = (s: AgentSession) => s.extensionRunner.getExtensionPaths().filter((p) => p.includes("planted"));
    expect(planted(session as AgentSession)).toEqual([]);
    await reloadContext(session);
    expect(planted(session as AgentSession)).toEqual([]);
    const next = (await factory({ sessionFile: null })).session as AgentSession;
    expect(planted(next)).toEqual([]);
    expect(markers.filter((m) => existsSync(m))).toEqual([]);
    session.dispose();
    next.dispose();
  });

  test("the session is bound to the headless UI, and a reload keeps it bound", async () => {
    const delivered: string[] = [];
    const asks = new ChatAsks({ deliver: (a) => delivered.push(a.question), timeoutMs: 5 });
    const ui = createHeadlessUIContext(asks);
    const session = (await createPiChatSessionFactory(testConfig())({ sessionFile: null, ui })).session as AgentSession;
    expect(session.extensionRunner.hasUI()).toBe(true);
    await reloadContext(session);
    expect(session.extensionRunner.hasUI()).toBe(true);
    expect(await session.extensionRunner.getUIContext().confirm("Ok?", "after reload")).toBe(false);
    expect(delivered).toEqual(["Ok?\nafter reload"]);
    session.dispose();
  });

  test("without a UI the session stays headless", async () => {
    const session = await realSession();
    expect(session.extensionRunner.hasUI()).toBe(false);
    session.dispose();
  });
});


test("shared owner-request tools survive real Pi main/topic reload and share canonical decisions", async () => {
  const config = testConfig();
  const ownerRequests = new OwnerRequests();
  let n = 0;
  const asks = ["main", "topic"].map(conversationId => new ChatAsks({ ownerRequests, origin: () => ({ surface: "web", conversationId }), newId: () => `shared-${++n}`, deliver: () => {} }));
  const sessions: AgentSession[] = [];
  try {
    for (const [index, conversationId] of ["main", "topic"].entries()) {
      const built = await createPiChatSessionFactory(config, { ownerRequests, origin: { surface: "web", conversationId } })({ sessionFile: null, ui: createHeadlessUIContext(asks[index]!) });
      const session = built.session as AgentSession;
      sessions.push(session);
      expect(session.getActiveToolNames()).toContain("list_owner_requests");
      expect(session.getActiveToolNames()).toContain("request_owner_decision");
      await reloadContext(session);
      expect(session.getActiveToolNames()).toContain("request_owner_decision");
    }
    const tools = ownerRequests.tools(asks[0]);
    const decision = { itemKey: "task:t-one", decisionKey: "date", question: "Which day?", choices: ["Monday", "Tuesday"] };
    const first = tools.find(t => t.name === "request_owner_decision")!.execute("one", decision, undefined, undefined, {} as any);
    const duplicate = await ownerRequests.tools(asks[1]).find(t => t.name === "request_owner_decision")!.execute("two", decision, undefined, undefined, {} as any);
    expect(duplicate.content[0]).toMatchObject({ type: "text", text: expect.stringContaining('"status":"already_pending"') });
    asks[0]!.answer("wsask:shared-1", "Monday");
    expect((await first).content[0]).toMatchObject({ type: "text", text: expect.stringContaining('"answer":"Monday"') });
  } finally {
    for (const ask of asks) ask.cancelAll("test");
    for (const session of sessions) session.dispose();
  }
});
