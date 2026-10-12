import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPrompt, systemPrompt } from "./consolidation.ts";
import { anchoredInstruction } from "./contextEconomy.ts";
import { HOME_TEMPLATE_DIR } from "./home.ts";
import { loopNudge } from "./loopGuard.ts";
import { stopNote } from "./personalSession.ts";
import { heartbeatPrompt, jobPreamble } from "./proactive.ts";
import { createSendFileTool } from "./sendFile.ts";
import { ToolStubs, deniedText } from "./toolStubs.ts";

const NOW = new Date("2026-10-12T09:00:00Z");

describe("prompts with a name", () => {
  test("name the user, and the job preamble says so once", () => {
    const preamble = jobPreamble("brief", NOW, "UTC", "Sam");
    expect(preamble).toContain("You are Sam's personal agent");
    expect(preamble).toContain("outside the chat with Sam.");
    expect(preamble).toContain("The user's name is Sam.");
    expect(heartbeatPrompt("Sam")).toContain("needs Sam's attention");
    expect(systemPrompt("Sam")).toContain("memory files of Sam's personal agent");
    expect(systemPrompt("Sam")).toContain("The user's name is Sam.");
    const prompt = buildPrompt({ user: "", memory: "", notes: [], today: "2026-10-12", ownerName: "Sam" });
    expect(prompt).toContain("Consolidate Sam's memory files.");
    expect(prompt).toContain("USER.md holds facts about Sam:");
    expect(stopNote("Sam")).toStartWith("[note] Sam stopped the previous turn");
    expect(deniedText("Sam")).toContain("ask Sam in chat");
    expect(loopNudge("Sam")).toContain("summarize for Sam what you tried");
    const summary = anchoredInstruction("compaction", undefined, "Sam");
    expect(summary).toStartWith("[context summary request — not from the user]");
    expect(summary).toContain("do not reply to Sam.");
    expect(summary).toContain("Quote Sam's own words");
  });
});

describe("prompts without a name", () => {
  test("say the user and add no name line", () => {
    const texts = [
      jobPreamble("brief", NOW, "UTC"),
      heartbeatPrompt(),
      systemPrompt(),
      buildPrompt({ user: "", memory: "", notes: [], today: "2026-10-12" }),
      stopNote(),
      deniedText(),
      loopNudge(),
      anchoredInstruction("recap"),
    ];
    for (const text of texts) {
      expect(text).not.toContain("name is");
      expect(text).not.toMatch(/\bdrk\b/);
    }
    expect(jobPreamble("brief", NOW, "UTC")).toContain("You are the user's personal agent");
    expect(stopNote()).toStartWith("[note] The user stopped the previous turn");
    expect(deniedText()).toContain("ask the user in chat");
  });
});

describe("tool texts", () => {
  test("send_file's description stays owner-neutral, since a session keeps it", () => {
    const paths = { cwd: "/h", home: "/h", agentDir: "/a", stateDir: "/s" };
    const tool = createSendFileTool(paths, () => null, undefined, () => "Sam");
    expect(tool.promptSnippet).toContain("your reply to the user");
    expect(tool.description).toContain("only if the user approves it");
    expect(tool.description).not.toContain("Sam");
  });

  test("proxied tools run through the gateway and need the user's approval", () => {
    const stubs = new ToolStubs({ principalId: "p", request: async () => ({}), ownerName: () => "Sam" });
    const entry = { name: "file_linear_issue", description: "d", inputSchema: {}, approval: "ask" as const };
    expect(stubs.definition(entry, { agentId: "main", agentName: "main" }).promptSnippet).toBe("file_linear_issue: runs through the gateway and needs the user's approval in chat");
  });

  test("a denial names one person", () => {
    expect(deniedText("Sam")).toStartWith("Sam denied this call.");
    expect(deniedText()).toStartWith("The user denied this call. Do not retry it; ask the user in chat");
  });
});

describe("home templates", () => {
  test("never name a particular owner", () => {
    for (const file of readdirSync(HOME_TEMPLATE_DIR)) {
      expect({ file, drk: /\bdrk\b/i.test(readFileSync(join(HOME_TEMPLATE_DIR, file), "utf8")) }).toEqual({ file, drk: false });
    }
  });
});
