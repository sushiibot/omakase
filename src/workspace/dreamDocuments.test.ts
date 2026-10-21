import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryEvidence, type Evidence } from "./memoryEvidence.ts";
import { DOCUMENTS_BEGIN, DOCUMENTS_END, prepareDocumentWrites } from "./dreamDocuments.ts";
import { MARKERS, runConsolidation, type ConsolidationDeps } from "./consolidation.ts";

let root: string, home: string, agent: string, index: MemoryEvidence;
const user = "# User\n- Prefers quick meals. (src: 2026-10-01, web:old)\n";
const memory = "# Memory\n";
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "dream-docs-")); home = join(root, "home"); agent = join(root, "agent");
  mkdirSync(join(home, "memory/topics"), { recursive: true });
  mkdirSync(join(agent, "chat"), { recursive: true });
  writeFileSync(join(home, "USER.md"), user); writeFileSync(join(home, "MEMORY.md"), memory);
  writeFileSync(join(home, "memory/catalog.md"), "# Catalog\n");
  writeFileSync(join(agent, "chat/source.jsonl"), [
    { type: "session" },
    { type: "message", timestamp: "2026-10-12T10:00:00Z", message: { role: "user", content: "[web:food 2026-10-12 10:00 UTC]\nI enjoy butter beans." } },
    { type: "message", timestamp: "2026-10-12T10:00:01Z", message: { role: "toolResult", toolName: "browser", content: "Whole Foods order: butter beans 2 cans; cannellini beans 1 can." } },
  ].map(e => JSON.stringify(e)).join("\n") + "\n");
  index = new MemoryEvidence(home, agent); await index.refresh();
});
afterEach(() => { index.close(); rmSync(root, { recursive: true, force: true }); });

function proposal(id: string, curated = user, path = "memory/topics/groceries.md") {
  return [MARKERS.userBegin, curated, MARKERS.userEnd, MARKERS.memoryBegin, memory, MARKERS.memoryEnd,
    DOCUMENTS_BEGIN, JSON.stringify([
      { path, content: `# Groceries\nupdated: 2026-10-12\nverified: 2026-10-12\n- Observed Whole Foods order: butter beans 2 cans; cannellini beans 1 can. Historical purchase, not current inventory. [evidence:${id}]\n` },
      { path: "memory/catalog.md", content: "# Catalog\n- [Groceries](memory/topics/groceries.md) — Dated purchases. Read when: suggesting meals or recalling purchases.\n" },
    ]), DOCUMENTS_END, MARKERS.summaryBegin, "promoted: sourced grocery snapshot", MARKERS.summaryEnd].join("\n");
}

function deps(propose: ConsolidationDeps["propose"]): ConsolidationDeps {
  return { home, stateDir: join(root, "state"), evidence: index, propose, commit: async () => ({ committed: false }), now: () => new Date("2026-10-12T12:00:00Z") };
}

test("new source activity triggers capture without daily notes and preserves detailed topics outside the profile", async () => {
  const original = readFileSync(join(agent, "chat/source.jsonl"));
  const id = index.search("cannellini").results[0]!.id;
  const d = deps(async (_system, prompt) => {
    expect(prompt).toContain("Investigate related older records");
    expect(prompt).toContain("cannellini beans 1 can");
    return { text: proposal(id), model: "fake" };
  });
  expect((await runConsolidation(d)).status).toBe("applied");
  expect(readFileSync(join(home, "memory/topics/groceries.md"), "utf8")).toContain("cannellini beans 1 can");
  expect(readFileSync(join(home, "USER.md"), "utf8")).toBe(user);
  expect(readFileSync(join(agent, "chat/source.jsonl"))).toEqual(original);
  // The new topic is indexed but never starts an extraction feedback loop.
  expect((await runConsolidation(d)).status).toBe("skipped");
});

test("dreaming can read evidence beyond its seed batch and use the actual user source tag", async () => {
  const food = index.search("cannellini").results[0]!.id;
  const d = deps(async (_system, _prompt, reads) => {
    await index.tools(reads)[1]!.execute("read", { id: food }, undefined, undefined, {} as never);
    return { text: proposal(food, user + "- Enjoys butter beans. (src: 2026-10-12, web:food)\n"), model: "fake" };
  });
  d.limits = { maxNoteBytes: 1 }; // only the first user record fits; the tool observation needs retrieval
  expect((await runConsolidation(d)).status).toBe("applied");
  expect(readFileSync(join(home, "USER.md"), "utf8")).toContain("Enjoys butter beans");
  expect(index.pending(JSON.parse(readFileSync(join(root, "state/consolidation.json"), "utf8")).evidenceCursor).records).toHaveLength(1);
});

test("a citation must be read, not merely named; rejected work does not advance its cursor", async () => {
  const d = deps(async () => ({ text: proposal("0123456789abcdef01234567"), model: "fake" }));
  expect((await runConsolidation(d)).status).toBe("rejected");
  const state = JSON.parse(readFileSync(join(root, "state/consolidation.json"), "utf8"));
  expect(state.evidenceCursor).toBeUndefined();
  expect(readFileSync(join(home, "memory/catalog.md"), "utf8")).toBe("# Catalog\n");
});

test("dream proposals cannot write conversations or any path outside topic/catalog files", async () => {
  const d = deps(async () => ({ text: proposal(index.search("cannellini").results[0]!.id, user, "../agent/chat/source.jsonl"), model: "fake" }));
  expect((await runConsolidation(d)).status).toBe("rejected");
});

test("a live edit while dreaming waits defers the entire proposal", async () => {
  let idle = false;
  const d = deps(async () => ({ text: proposal(index.search("cannellini").results[0]!.id), model: "fake" }));
  d.live = { isIdle: () => idle, requestContextReload() { throw new Error("must not apply"); } };
  d.sleep = async () => { writeFileSync(join(home, "memory/catalog.md"), "# Owner edited this\n"); idle = true; };
  expect((await runConsolidation(d)).status).toBe("skipped");
  expect(readFileSync(join(home, "memory/catalog.md"), "utf8")).toBe("# Owner edited this\n");
});

test("an unsafe new destination cannot redirect host writes", () => {
  const target = join(root, "outside"); writeFileSync(target, "keep");
  symlinkSync(target, join(home, "memory/topics/new.md"));
  expect(() => prepareDocumentWrites(home, [{ path: "memory/topics/new.md", content: "replace" }])).toThrow();
  expect(readFileSync(target, "utf8")).toBe("keep");
});

test("capture skips busy conversations and does not repeatedly curate a full profile without new activity", async () => {
  let calls = 0;
  const d = deps(async () => { calls++; return { text: proposal(index.search("cannellini").results[0]!.id), model: "fake" }; });
  d.live = { isIdle: () => false, requestContextReload() {} };
  expect((await runConsolidation(d, { capture: true })).status).toBe("skipped");
  expect(calls).toBe(0);
  delete d.live;
  expect((await runConsolidation(d, { capture: true })).status).toBe("applied");
  writeFileSync(join(home, "USER.md"), "# User\n" + "standing context ".repeat(230));
  expect((await runConsolidation(d, { capture: true })).status).toBe("skipped");
  expect(calls).toBe(1);
});

test("capture waits for a new owner conversation to go quiet", async () => {
  let calls = 0;
  const d = deps(async () => { calls++; return { text: proposal(index.search("cannellini").results[0]!.id), model: "fake" }; });
  d.now = () => new Date("2026-10-12T10:10:00Z");
  expect((await runConsolidation(d, { capture: true })).summary).toContain("conversation active");
  d.now = () => new Date("2026-10-12T12:00:00Z");
  expect((await runConsolidation(d, { capture: true })).status).toBe("applied");
  // Tool-only activity (a subagent or a wake-up, no owner turn) waits for the nightly run.
  writeFileSync(join(agent, "chat/other.jsonl"), [{ type: "session" },
    { type: "message", timestamp: "2026-10-12T10:30:00Z", message: { role: "toolResult", toolName: "browser", content: "Order shipped." } },
  ].map(e => JSON.stringify(e)).join("\n") + "\n");
  expect((await runConsolidation(d, { capture: true })).summary).toContain("no new conversation");
  expect(calls).toBe(1);
});

test("an index rebuild does not strand new evidence behind an old cursor", async () => {
  const d = deps(async () => ({ text: proposal(index.search("cannellini").results[0]!.id), model: "fake" }));
  expect((await runConsolidation(d)).status).toBe("applied");
  const oldGeneration = index.generation;
  index.close();
  rmSync(join(agent, "memory-evidence.sqlite"));
  index = new MemoryEvidence(home, agent);
  d.evidence = index;
  expect(index.generation).not.toBe(oldGeneration);
  expect((await runConsolidation(d)).status).toBe("applied");
});
