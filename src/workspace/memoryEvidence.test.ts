import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryEvidence, readMemoryDocument } from "./memoryEvidence.ts";

let root: string, home: string, agentDir: string, session: string, index: MemoryEvidence;
const entry = (role: string, content: unknown, extra = {}) => JSON.stringify({ type: "message", timestamp: "2026-10-12T10:00:00Z", message: { role, content, ...extra } }) + "\n";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "memory-evidence-"));
  home = join(root, "home"); agentDir = join(root, "agent");
  mkdirSync(join(home, "memory/topics"), { recursive: true });
  mkdirSync(join(agentDir, "chat"), { recursive: true });
  session = join(agentDir, "chat/session.jsonl");
  writeFileSync(session, '{"type":"session"}\n');
  index = new MemoryEvidence(home, agentDir);
});
afterEach(() => { index.close(); rmSync(root, { recursive: true, force: true }); });

test("exact purchases are searchable before dreaming, including full tool results past the history truncation", async () => {
  appendFileSync(session, entry("user", "[web:order1 2026-10-12 10:00 UTC]\nHere is my grocery order."));
  appendFileSync(session, entry("toolResult", "Order:\n" + "Apples\n".repeat(4000) + "Butter beans: 2 cans; cannellini beans: 1 can", { toolName: "browser" }));
  const original = readFileSync(session);
  await index.refresh();
  const hit = index.search("cannellini").results[0]!;
  const row = index.read(hit.id)!;
  expect(row.role).toBe("tool:browser");
  expect(row.text).toContain("Butter beans: 2 cans; cannellini beans: 1 can");
  expect(row.parts).toBeGreaterThan(1);
  expect(index.search("volcano").results).toEqual([]);
  expect(readFileSync(session)).toEqual(original);
  expect(index.pending(0).records.some(e => e.tag === "(src: 2026-10-12, web:order1)")).toBe(true);
});

test("new turns and corrections are visible immediately, without duplicate records or an extraction model", async () => {
  appendFileSync(session, entry("user", "[web:first 2026-10-12 10:00 UTC]\nI like cannellini beans."));
  await index.refresh();
  const first = index.pending(0);
  appendFileSync(session, entry("user", "[web:second 2026-10-12 11:00 UTC]\nCorrection: those cannellini beans were for a friend."));
  await index.refresh();
  expect(index.search("cannellini").results).toHaveLength(2);
  const pending = index.pending(first.cursor);
  expect(pending.records).toHaveLength(1);
  expect(pending.records[0]!.text).toContain("for a friend");
  await index.refresh();
  expect(index.pending(pending.cursor).records).toEqual([]);
});

test("incomplete appended lines wait for completion; arbitrary search syntax stays data", async () => {
  const line = entry("user", "[web:partial 2026-10-12 10:00 UTC]\nGreat Northern beans");
  appendFileSync(session, line.slice(0, -5));
  await index.refresh();
  expect(index.search("Northern").results).toEqual([]);
  appendFileSync(session, line.slice(-5));
  await index.refresh();
  expect(index.search('"Northern" OR (beans):*').results).toHaveLength(1);
});

test("search and reads redact secrets and exclude retrieved memory copies", async () => {
  const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123";
  appendFileSync(session, entry("toolResult", `Butter beans. Token ${secret}`, { toolName: "browser" }));
  appendFileSync(session, entry("toolResult", "Unicorn repeated search result", { toolName: "memory_search" }));
  await index.refresh();
  expect(index.search(secret).results).toEqual([]);
  expect(index.search("Unicorn").results).toEqual([]);
  expect(index.read(index.search("butter").results[0]!.id)!.text).toContain("[REDACTED]");
});

test("source files and topic files refuse links; deleted sources leave the index", async () => {
  writeFileSync(join(root, "outside.jsonl"), '{"type":"session"}\n' + entry("user", "outside secret pudding"));
  symlinkSync(join(root, "outside.jsonl"), join(agentDir, "chat/link.jsonl"));
  symlinkSync(join(root, "outside.jsonl"), join(home, "memory/topics/link.md"));
  writeFileSync(join(home, "memory/topics/food.md"), "Historical refried beans");
  await index.refresh();
  expect(index.search("pudding").results).toEqual([]);
  expect(readMemoryDocument(home, "memory/topics/link.md")).toBeNull();
  expect(index.search("refried").results).toHaveLength(1);
  rmSync(join(home, "memory/topics/food.md"));
  await index.refresh();
  expect(index.search("refried").results).toEqual([]);
});

test("paginated evidence tools keep all parts available and record only full reads for grounding", async () => {
  appendFileSync(session, entry("user", "[web:long 2026-10-12 10:00 UTC]\n" + "beans ".repeat(14000)));
  const reads = new Map();
  const [search, read] = index.tools(reads);
  const call = async (tool: typeof search, args: object) => JSON.parse((await tool.execute("test", args as never, undefined, undefined, {} as never)).content.map(c => c.type === "text" ? c.text : "").join(""));
  const page = await call(search, { query: "beans" });
  expect(page.next).toBe(8);
  expect(reads.size).toBe(0);
  const detail = await call(read, { id: page.results[0].id });
  expect(detail.neighbors).toHaveLength(detail.parts);
  expect(reads.size).toBe(1);
  expect((await call(search, { query: "beans", offset: page.next })).results.length).toBeGreaterThan(0);
});

test("dream investigations do not turn repeated copies of old facts into new evidence", async () => {
  mkdirSync(join(agentDir, "job-sessions"));
  const job = join(agentDir, "job-sessions/dream.jsonl");
  writeFileSync(job, '{"type":"session"}\n' + entry("user", "Consolidate the user's memory files. Today is 2026-10-12.") + entry("toolResult", "Copied butter beans note", { toolName: "read" }));
  await index.refresh();
  appendFileSync(job, entry("assistant", "Repeated butter beans claim"));
  await index.refresh();
  expect(index.search("butter").results).toEqual([]);
});
