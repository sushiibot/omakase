import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryEntries, memorySources, parseMemoryUpdate, renderMemoryUpdate, reviewProblems, MEMORY_REVIEW_SYSTEM, type MemoryFiles, type MemoryUpdate } from "./memoryUpdates.ts";
import { runConsolidation, type ConsolidationDeps, type NoteChunk } from "./consolidation.ts";
import type { Evidence } from "./memoryEvidence.ts";
import { reviewMemoryDecisions } from "./memoryDecisions.ts";
import { RunLog } from "./runLog.ts";

const before: MemoryFiles = {
  "USER.md": "# User\n\n- Avoids dairy. (src: 2026-10-01, web:a; web:b)\n- Old entry without a recognized tag.\n",
  "MEMORY.md": "# Memory\n",
};
const note: NoteChunk = { file: "2026-10-14.md", date: "2026-10-14", text: "User said: I avoid dairy. I bought tofu yesterday.", endOffset: 52 };
const evidence: Evidence = { id: "a".repeat(24), role: "user", source: "chat.jsonl", tag: "(src: 2026-10-14, web:food)", text: "I avoid dairy. I bought tofu yesterday.", at: "2026-10-14T10:00:00Z", seq: 1, part: 0, parts: 1 };
const reads = new Map([[evidence.id, evidence]]);
const sources = () => memorySources(before, [note], reads);
const upsert = (text = "Prefers dairy-free meals."): MemoryUpdate => ({ operations: [{ op: "upsert", file: "USER.md", text, kind: "fact", sources: [evidence.id] }], documents: [], summary: "remember preference" });
const verdict = (value: string, id = "operation:0", reason = "supported by source") => JSON.stringify({ decisions: [{ id, verdict: value, reason }] });

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "memory-updates-"));
  mkdirSync(join(root, "memory/topics"), { recursive: true });
  for (const [file, content] of Object.entries(before)) writeFileSync(join(root, file), content);
  writeFileSync(join(root, "memory", note.file), note.text);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const read = (file: string) => readFileSync(join(root, file), "utf8");
function deps(update: MemoryUpdate): ConsolidationDeps {
  return {
    home: root, stateDir: join(root, "state"),
    propose: async (_system, _prompt, supplied) => { supplied!.set(evidence.id, evidence); return { text: JSON.stringify(update), model: "capture-fixture" }; },
    review: async (system) => { expect(system).toBe(MEMORY_REVIEW_SYSTEM); return { text: verdict("supported"), model: "review-fixture" }; },
    commit: async () => ({ committed: false }),
  };
}

test("host renders citations and accepts paraphrases without counting shared words", () => {
  const result = renderMemoryUpdate(upsert(), before, sources(), {});
  expect(result.user).toContain(`- Prefers dairy-free meals. [evidence:${evidence.id}] (src: 2026-10-14, web:food)`);
  expect(result.user).toContain("Old entry without a recognized tag.");
});

test("one source can support several memories, including labeled observations", () => {
  const update = upsert();
  update.operations.push({ op: "upsert", file: "MEMORY.md", text: "Purchased tofu on 2026-10-13.", kind: "observation", sources: [evidence.id] });
  expect(renderMemoryUpdate(update, before, sources(), {}).memory).toContain("Observation: Purchased tofu");
});

test("explicit replacement and removal work for multi-reference and untagged legacy entries", () => {
  const entries = memoryEntries(before);
  const update = upsert();
  update.operations[0] = { ...update.operations[0] as Extract<MemoryUpdate["operations"][number], { op: "upsert" }>, id: entries[0]!.id };
  update.operations.push({ op: "remove", id: entries[1]!.id, sources: [], reason: "obsolete" });
  const result = renderMemoryUpdate(update, before, sources(), {});
  expect(result.user).not.toContain("Avoids dairy.");
  expect(result.user).not.toContain("Old entry");
  expect(result.user).toContain("Prefers dairy-free meals.");
});

test("topic pointers require a destination, not overlapping receipt words", () => {
  const update: MemoryUpdate = { operations: [{ op: "link", path: "memory/topics/grocery-orders.md" }], documents: [], summary: "" };
  expect(() => renderMemoryUpdate(update, before, sources(), {})).toThrow("unknown topic");
  const result = renderMemoryUpdate(update, before, sources(), { "memory/topics/grocery-orders.md": "# Orders" });
  expect(result.memory).toBe("# Memory\n- See [grocery orders](memory/topics/grocery-orders.md).\n");
  expect(renderMemoryUpdate(update, { ...before, "MEMORY.md": result.memory }, sources(), { "memory/topics/grocery-orders.md": "# Orders" }).memory).toBe(result.memory);
});

test("unknown sources, duplicate edits and malformed updates fail structurally", () => {
  const update = upsert();
  expect(() => renderMemoryUpdate(update, before, new Map(), {})).toThrow("unread source");
  const id = memoryEntries(before)[0]!.id;
  update.operations = [{ op: "remove", id, reason: "obsolete", sources: [] }, { op: "remove", id, reason: "obsolete", sources: [] }];
  expect(() => renderMemoryUpdate(update, before, sources(), {})).toThrow("multiple edits");
  expect(() => parseMemoryUpdate('{"operations":[{"op":"upsert","text":"x\\ny"}]}')).toThrow();
  expect(() => parseMemoryUpdate('{"operations":[],"documents":[{"path":"../outside","content":"x"}]}')).toThrow();
});

test("tool observations cannot directly establish personal preferences", () => {
  const support = sources();
  support.set(evidence.id, { ...support.get(evidence.id)!, role: "toolResult", tag: undefined });
  expect(() => renderMemoryUpdate(upsert("Loves tofu."), before, support, {})).toThrow("personal facts need user evidence");
});

test("inference is labeled by the host and cannot enter USER.md", () => {
  const update = upsert();
  const op = update.operations[0] as Extract<MemoryUpdate["operations"][number], { op: "upsert" }>;
  op.kind = "inference";
  expect(() => renderMemoryUpdate(update, before, sources(), {})).toThrow("inferences belong");
  op.file = "MEMORY.md";
  expect(renderMemoryUpdate(update, before, sources(), {}).memory).toContain("Inference (unverified):");
  expect(reviewProblems(verdict("inference"), update)).toEqual([]);
});

test("review must cover every change exactly once and cannot silently downgrade a fact to inference", () => {
  expect(() => reviewProblems('{"decisions":[]}', upsert())).toThrow("omitted");
  expect(() => reviewProblems(verdict("supported", "operation:9"), upsert())).toThrow("unknown");
  const d = JSON.parse(verdict("supported")).decisions[0];
  expect(() => reviewProblems(JSON.stringify({ decisions: [d, d] }), upsert())).toThrow("duplicate");
  expect(reviewProblems(verdict("inference"), upsert())).toHaveLength(1);
});

test("capture uses semantic review, applies supported paraphrase and records reviewer", async () => {
  const d = deps(upsert());
  d.review = async (system, prompt) => {
    expect(system).toContain("negation reversals");
    expect(JSON.parse(prompt).sources.some((s: { text: string }) => s.text === evidence.text)).toBe(true);
    return { text: verdict("supported"), model: "review-fixture" };
  };
  expect((await runConsolidation(d, { capture: true })).status).toBe("applied");
  expect(read("USER.md")).toContain("Prefers dairy-free meals.");
  expect(read("DREAMS.md")).toContain("Semantic review model: review-fixture");
});

test.each([0.99, 0.1])("native decision review controls memory application at probability %s", async probability => {
  const d = deps(upsert());
  const request = (async () => Response.json({ model: "decision-fixture", answers: { item_0: { type: "noul", noul: probability } } })) as import("./memoryDecisions.ts").DecisionRequest;
  d.review = async (_system, prompt) => reviewMemoryDecisions({ apiKey: "test", baseUrl: "https://openrouter.ai/api/v1" }, prompt, new RunLog(d.stateDir), request);
  const result = await runConsolidation(d, { capture: true });
  expect(result.status).toBe(probability >= 0.95 ? "applied" : "rejected");
  expect(read("USER.md").includes("Prefers dairy-free meals.")).toBe(probability >= 0.95);
  if (probability < 0.95) expect(JSON.parse(readFileSync(join(d.stateDir, "consolidation.json"), "utf8")).notes).toEqual({});
});

test("review outage cannot turn into a no-op repair that consumes pending evidence", async () => {
  const d = deps(upsert());
  let proposals = 0;
  const propose = d.propose;
  d.propose = async (...args) => {
    proposals++;
    if (proposals > 1) return { text: '{"operations":[]}', model: "fixture" };
    return propose(...args);
  };
  d.review = async () => { throw new Error("review unavailable"); };
  const result = await runConsolidation(d, { capture: true });
  expect(result.status).toBe("rejected");
  expect(result.reasons?.[0]).toContain("invalid memory review");
  expect(proposals).toBe(1);
  expect(read("USER.md")).toBe(before["USER.md"]);
  expect(JSON.parse(readFileSync(join(d.stateDir, "consolidation.json"), "utf8")).notes).toEqual({});
});

test("semantic objection gets one repair attempt before writing", async () => {
  let proposals = 0, reviews = 0;
  const d = deps(upsert());
  d.propose = async (_system, prompt, supplied) => {
    supplied!.set(evidence.id, evidence); proposals++;
    if (proposals === 2) expect(prompt).toContain("negation reversed");
    return { text: JSON.stringify(upsert(proposals === 1 ? "Likes dairy." : "Prefers dairy-free meals.")), model: "fixture" };
  };
  d.review = async () => ({ text: verdict(++reviews === 1 ? "unsupported" : "supported", "operation:0", "negation reversed"), model: "judge" });
  expect((await runConsolidation(d, { capture: true })).status).toBe("applied");
  expect(proposals).toBe(2);
  expect(read("USER.md")).not.toContain("Likes dairy.");
});

test.each(["Loves tofu.", "Enjoys dairy.", "Still traveling next week."])("unsupported claim stays pending: %s", async claim => {
  let reviews = 0;
  const d = deps(upsert(claim));
  d.review = async () => { reviews++; return { text: verdict("unsupported", "operation:0", "unsupported inference, negation or stale date"), model: "judge" }; };
  expect((await runConsolidation(d, { capture: true })).status).toBe("rejected");
  expect(reviews).toBe(2);
  expect(read("USER.md")).toBe(before["USER.md"]);
  expect(JSON.parse(read("state/consolidation.json")).notes).toEqual({});
  expect((await runConsolidation(d, { capture: true })).status).toBe("skipped");
});

test("invalid or missing review decisions never write memory", async () => {
  const d = deps(upsert());
  d.review = async () => ({ text: '{"decisions":[]}', model: "judge" });
  expect((await runConsolidation(d, { capture: true })).status).toBe("rejected");
  expect(read("USER.md")).toBe(before["USER.md"]);
});

test("no-op capture does not spend a review call", async () => {
  const d = deps({ operations: [], documents: [], summary: "nothing durable" });
  d.review = async () => { throw new Error("must not review"); };
  expect((await runConsolidation(d, { capture: true })).status).toBe("applied");
});

test("review cannot overwrite a concurrent owner edit", async () => {
  const d = deps(upsert());
  d.review = async () => { writeFileSync(join(root, "USER.md"), "# Owner changed this\n"); return { text: verdict("supported"), model: "judge" }; };
  expect((await runConsolidation(d, { capture: true })).status).toBe("skipped");
  expect(read("USER.md")).toBe("# Owner changed this\n");
});

test("topic paraphrase uses semantic review while keeping actual citation validation", async () => {
  const update: MemoryUpdate = { operations: [{ op: "link", path: "memory/topics/food.md" }], documents: [
    { path: "memory/topics/food.md", content: `# Food\nupdated: 2026-10-14\nverified: 2026-10-14\n- Excludes milk products from meals. [evidence:${evidence.id}]\n` },
    { path: "memory/catalog.md", content: "# Topics\n- [Food](memory/topics/food.md) — Diet. Read when: planning dinner.\n" },
  ], summary: "" };
  const d = deps(update);
  d.review = async () => ({ text: JSON.stringify({ decisions: ["operation:0", "document:0", "document:1"].map(id => ({ id, verdict: "supported", reason: "faithful paraphrase or routing" })) }), model: "judge" });
  expect((await runConsolidation(d, { capture: true })).status).toBe("applied");
  expect(read("MEMORY.md")).toContain("](memory/topics/food.md)");
  update.documents[0]!.content = update.documents[0]!.content.replace(evidence.id, "b".repeat(24));
  expect((await runConsolidation(d, { force: true })).status).toBe("rejected");
});

test("rewriting an observation preserves its original evidence references", () => {
  const files = { ...before, "MEMORY.md": `# Memory\n- Observation: Bought tofu. [evidence:${evidence.id}]\n` };
  const entry = memoryEntries(files).find(e => e.file === "MEMORY.md")!;
  const update: MemoryUpdate = { operations: [{ op: "upsert", id: entry.id, file: "MEMORY.md", text: "Purchased tofu.", kind: "observation", sources: [entry.id] }], documents: [], summary: "" };
  expect(renderMemoryUpdate(update, files, memorySources(files, [], new Map()), {}).memory).toContain(`[evidence:${evidence.id}]`);
});

test("unchanged rejected work becomes eligible after the retry interval", async () => {
  const d = deps(upsert());
  let at = new Date("2026-10-14T12:00:00Z");
  d.now = () => at;
  d.review = async () => ({ text: "invalid", model: "judge" });
  expect((await runConsolidation(d, { capture: true })).status).toBe("rejected");
  expect((await runConsolidation(d, { capture: true })).status).toBe("skipped");
  at = new Date("2026-10-14T12:30:00Z");
  d.review = async () => ({ text: verdict("supported"), model: "judge" });
  expect((await runConsolidation(d, { capture: true })).status).toBe("applied");
  expect(JSON.parse(read("state/consolidation.json")).lastRejected).toBeUndefined();
});

test("the model cannot smuggle invented citations into the text field", () => {
  expect(() => parseMemoryUpdate(JSON.stringify(upsert("Likes tea. (src: 2026-10-14, web:invented)")))).toThrow("citations are rendered by the host");
});

test("bare entry hashes resolve exactly and the reviewer sees the canonical replacement", async () => {
  const id = memoryEntries(before)[0]!.id;
  const update = upsert();
  Object.assign(update.operations[0]!, { id: id.slice("entry-".length) });
  const d = deps(update);
  d.review = async (_system, prompt) => {
    expect(JSON.parse(prompt).items[0].change.id).toBe(id);
    return { text: verdict("supported"), model: "judge" };
  };
  expect((await runConsolidation(d, { capture: true })).status).toBe("applied");
  expect(read("USER.md")).not.toContain("Avoids dairy.");
  expect(read("USER.md")).toContain("Prefers dairy-free meals.");
});

test("evidence mistaken for an edit target is repaired with retrieved evidence available", async () => {
  const invalid = upsert();
  Object.assign(invalid.operations[0]!, { id: evidence.id });
  const d = deps(invalid);
  let attempts = 0;
  d.propose = async (_system, prompt, supplied) => {
    supplied!.set(evidence.id, evidence);
    if (++attempts === 2) {
      expect(prompt).toContain("This is a source ID, not an existing entry ID");
      expect(prompt).toContain("For a new upsert, omit id");
      expect(prompt).toContain(evidence.text);
    }
    return { text: JSON.stringify(attempts === 1 ? invalid : upsert()), model: "fixture" };
  };
  expect((await runConsolidation(d, { capture: true })).status).toBe("applied");
  expect(attempts).toBe(2);
  expect(read("USER.md")).toContain("Avoids dairy.");
});

test("unknown and ambiguous target hashes cannot delete entries or silently add replacements", () => {
  for (const id of ["3f479afbb5aaccd717efb678", evidence.id]) {
    expect(() => renderMemoryUpdate({ operations: [{ op: "remove", id, reason: "obsolete", sources: [] }], documents: [], summary: "" }, before, sources(), {})).toThrow("unknown entry");
    const update = upsert();
    Object.assign(update.operations[0]!, { id });
    expect(() => renderMemoryUpdate(update, before, sources(), {})).toThrow("unknown entry");
  }
  const canonical = memoryEntries(before)[0]!.id;
  const bare = canonical.slice(6);
  const ambiguous = sources();
  ambiguous.set(bare, { id: bare, role: "user", text: "different evidence" });
  const update = upsert();
  Object.assign(update.operations[0]!, { id: bare });
  expect(() => renderMemoryUpdate(update, before, ambiguous, {})).toThrow("source ID");
  update.operations.push({ op: "remove", id: canonical, reason: "obsolete", sources: [] });
  expect(() => renderMemoryUpdate(update, before, sources(), {})).toThrow("multiple edits");
});

test("empty edit target IDs are rejected instead of silently ignoring removals", () => {
  expect(() => parseMemoryUpdate(JSON.stringify({ operations: [{ op: "remove", id: "", reason: "obsolete", sources: [] }] }))).toThrow();
});
