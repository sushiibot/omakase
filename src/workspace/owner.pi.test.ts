import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { WorkspaceConfig } from "./config.ts";
import { createPiChatSessionFactory, reloadContext } from "./piChatSession.ts";

// A real Pi session from the workspace factory; no model call is made.
let root: string;
const realFetch = globalThis.fetch;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ws-owner-pi-"));
  mkdirSync(join(root, "agent"), { recursive: true });
  mkdirSync(join(root, "home"), { recursive: true });
  globalThis.fetch = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(root, { recursive: true, force: true });
});

test("the main session's system prompt names the user, and a context reload picks up a change", async () => {
  const config = {
    provider: "openrouter",
    model: "openai/gpt-6-luna",
    apiKey: "test-openrouter-key",
    baseUrl: "http://openrouter.test/v1",
    agentDir: join(root, "agent"),
    home: join(root, "home"),
    stateDir: join(root, "state"),
    ownerName: "Sam",
  } as WorkspaceConfig;
  const factory = createPiChatSessionFactory(config);

  const named = (await factory({ sessionFile: null })).session as AgentSession;
  expect(named.systemPrompt).toContain("The user's name is Sam.");
  named.dispose();

  delete config.ownerName;
  const live = (await factory({ sessionFile: null })).session as AgentSession;
  config.ownerName = "Alex";
  expect(live.systemPrompt).not.toContain("The user's name is");
  await reloadContext(live);
  expect(live.systemPrompt).toContain("The user's name is Alex.");
  live.dispose();

  delete config.ownerName;
  const unnamed = (await factory({ sessionFile: null })).session as AgentSession;
  expect(unnamed.systemPrompt).not.toContain("The user's name is");
  unnamed.dispose();
});
