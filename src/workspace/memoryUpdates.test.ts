import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coreBudget, memoryEntries, memorySources, parseMemoryUpdate, renderMemoryUpdate, reviewProblems, MEMORY_REVIEW_SYSTEM, MEMORY_UPDATE_RULES, type MemoryFiles, type MemoryUpdate } from "./memoryUpdates.ts";
import { MAX_CAP_ROUNDS, retryDelayMs, runConsolidation, type ConsolidationDeps, type NoteChunk } from "./consolidation.ts";
import type { Evidence } from "./memoryEvidence.ts";
import { MemoryReviewError, reviewMemoryDecisions } from "./memoryDecisions.ts";
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

test.each([0.99, 0.9444, 0.90, 0.899, 0.1])("native decision review controls memory application at probability %s", async probability => {
  const d = deps(upsert());
  const request = (async () => Response.json({ model: "decision-fixture", answers: { item_0: { type: "noul", noul: probability } } })) as import("./memoryDecisions.ts").DecisionRequest;
  d.review = async (_system, prompt) => reviewMemoryDecisions({ apiKey: "test", baseUrl: "https://openrouter.ai/api/v1" }, prompt, new RunLog(d.stateDir), request);
  const result = await runConsolidation(d, { capture: true });
  expect(result.status).toBe(probability >= 0.90 ? "applied" : "rejected");
  expect(result.alert).toBe(probability >= 0.90 ? undefined : "silent");
  expect(read("USER.md").includes("Prefers dairy-free meals.")).toBe(probability >= 0.90);
  if (probability < 0.90) expect(JSON.parse(readFileSync(join(d.stateDir, "consolidation.json"), "utf8")).notes).toEqual({});
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
  expect(result.alert).toBeUndefined();
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

// ---------- backoff, reviewer outages and core memory pressure ----------

const approveAll: NonNullable<ConsolidationDeps["review"]> = async (_system, prompt) => ({
  text: JSON.stringify({ decisions: JSON.parse(prompt).items.map((i: { id: string }) => ({ id: i.id, verdict: "supported", reason: "faithful" })) }),
  model: "judge",
});
const state = () => JSON.parse(read("state/consolidation.json"));

test("the same rejected inputs back off exponentially up to a day; force overrides and an apply resets", async () => {
  expect([1, 2, 3, 4, 5, 6, 7, 40].map(retryDelayMs)).toEqual([30, 60, 120, 240, 480, 960, 1440, 1440].map(m => m * 60_000));
  const d = deps(upsert());
  let at = Date.parse("2026-10-14T12:00:00Z");
  d.now = () => new Date(at);
  let reviews = 0;
  d.review = async () => { reviews++; return { text: verdict("unsupported"), model: "judge" }; };
  expect((await runConsolidation(d, { capture: true })).status).toBe("rejected");
  expect(state().lastRejected.count).toBe(1);
  at += 29 * 60_000;
  expect((await runConsolidation(d, { capture: true })).summary).toContain("next attempt after 2026-10-14T12:30:00.000Z");
  at += 60_000;
  expect((await runConsolidation(d, { capture: true })).status).toBe("rejected");
  expect(state().lastRejected.count).toBe(2);
  // The second rejection waits an hour, not 30 min.
  at += 31 * 60_000;
  expect((await runConsolidation(d, { capture: true })).status).toBe("skipped");
  expect((await runConsolidation(d, { force: true, capture: true })).status).toBe("rejected");
  expect(state().lastRejected.count).toBe(3);
  // New inputs start a fresh count.
  writeFileSync(join(root, "memory", note.file), `${note.text}\nMore.`);
  expect((await runConsolidation(d, { capture: true })).status).toBe("rejected");
  expect(state().lastRejected.count).toBe(1);
  d.review = approveAll;
  expect((await runConsolidation(d, { force: true, capture: true })).status).toBe("applied");
  expect(state().lastRejected).toBeUndefined();
  expect(reviews).toBe(8);
});

test("a reviewer outage alerts once, backs off whatever the inputs, keeps evidence pending, and recovers", async () => {
  const d = deps(upsert());
  let at = Date.parse("2026-10-14T12:00:00Z");
  d.now = () => new Date(at);
  let proposals = 0;
  const propose = d.propose;
  d.propose = async (...args) => { proposals++; return propose(...args); };
  d.review = async () => { throw new MemoryReviewError("http_404"); };

  const first = await runConsolidation(d, { capture: true });
  expect(first).toMatchObject({ status: "rejected" });
  expect(first.alert).toBeUndefined();
  expect(first.reasons?.[0]).toContain("(http_404)");
  expect(state().reviewOutage).toMatchObject({ failures: 1, error: "http_404", since: "2026-10-14T12:00:00.000Z" });

  // New inputs do not bypass the outage backoff, and no proposal is spent.
  writeFileSync(join(root, "memory", note.file), `${note.text}\nMore.`);
  at += 10 * 60_000;
  const waiting = await runConsolidation(d, { capture: true });
  expect(waiting.status).toBe("skipped");
  expect(waiting.summary).toContain("memory reviewer unavailable since 2026-10-14T12:00:00.000Z (http_404");
  expect(proposals).toBe(1);

  // Later failures of the same outage are silent: one ongoing problem, not a new failed job every run.
  at += 25 * 60_000;
  const second = await runConsolidation(d, { capture: true });
  expect(second).toMatchObject({ status: "rejected", alert: "silent" });
  expect(state().reviewOutage.failures).toBe(2);
  expect(state().notes).toEqual({});

  // An apply that needed no review doesn't prove recovery, so it doesn't close the alert streak.
  at += 2 * 60 * 60_000;
  const quiet = deps({ operations: [], documents: [], summary: "nothing durable" });
  quiet.now = d.now;
  quiet.review = d.review;
  expect(await runConsolidation(quiet, { capture: true })).toMatchObject({ status: "applied", alert: "silent" });
  expect(state().reviewOutage.failures).toBe(2);

  // Still down a day after the first alert: alert again.
  at = Date.parse("2026-10-15T12:00:00Z");
  writeFileSync(join(root, "memory", note.file), `${note.text}\nEven more.`);
  const later = await runConsolidation(d, { capture: true });
  expect(later.status).toBe("rejected");
  expect(later.alert).toBeUndefined();

  // A successful review closes the outage; the apply is a visible success again.
  d.review = approveAll;
  const recovered = await runConsolidation(d, { force: true, capture: true });
  expect(recovered.status).toBe("applied");
  expect(recovered.alert).toBeUndefined();
  expect(state().reviewOutage).toBeUndefined();
});

test("a changed reviewer (e.g. a retired model replaced) retries at once instead of waiting out the backoff", async () => {
  const d = deps(upsert());
  const at = Date.parse("2026-10-14T12:00:00Z");
  d.now = () => new Date(at);
  d.reviewer = "perplexity/pplx-decider-v1.1-27b";
  d.review = async () => { throw new MemoryReviewError("http_404"); };
  expect((await runConsolidation(d, { capture: true })).status).toBe("rejected");
  expect(state().reviewOutage).toMatchObject({ failures: 1, reviewer: "perplexity/pplx-decider-v1.1-27b" });

  // Same reviewer, same inputs, minutes later: backed off.
  d.now = () => new Date(at + 5 * 60_000);
  expect((await runConsolidation(d, { capture: true })).status).toBe("skipped");

  // A deploy with a new chain: neither the outage nor the same-input backoff holds it back.
  d.reviewer = "perplexity/pplx-decider-v1.2,~typesafe/jev-latest";
  d.review = approveAll;
  const recovered = await runConsolidation(d, { capture: true });
  expect(recovered.status).toBe("applied");
  expect(recovered.alert).toBeUndefined();
  expect(state().reviewOutage).toBeUndefined();
});

const longMemory = "# Memory\n" + Array.from({ length: 36 }, (_, i) => `- Observation: project detail ${i} ${"x".repeat(160)} (src: 2026-10-01)`).join("\n") + "\n";
const bigFiles: MemoryFiles = { ...before, "MEMORY.md": longMemory };
const addition = (): MemoryUpdate["operations"][number] => ({ op: "upsert", file: "MEMORY.md", text: `Bought tofu. ${"y".repeat(400)}`, kind: "observation", sources: [evidence.id] });

test("the proposer sees each core file's size, cap and headroom, and demotion guidance past 85%", () => {
  expect(longMemory.length).toBeGreaterThan(6800);
  expect(longMemory.length).toBeLessThan(8000);
  expect(coreBudget(before, { "USER.md": 4000, "MEMORY.md": 8000 })).not.toContain("To demote");
  const budget = coreBudget(bigFiles, { "USER.md": 4000, "MEMORY.md": 8000 });
  expect(budget).toContain(`MEMORY.md: ${longMemory.length}/8000 characters`);
  expect(budget).toContain(`free at least ${longMemory.length - 6800} characters (target 6800)`);
  expect(budget).toContain("demoted to memory/topics/<slug>.md");
  expect(MEMORY_UPDATE_RULES).toContain('Every upsert requires "kind"');
  expect(MEMORY_UPDATE_RULES).toContain("Never put citations in text");
});

test("a removal claiming demotion must leave the entry line in its topic", () => {
  const entry = memoryEntries(bigFiles).find(e => e.file === "MEMORY.md")!;
  const update: MemoryUpdate = { operations: [{ op: "remove", id: entry.id, reason: "demoted to memory/topics/archive.md", sources: [] }], documents: [
    { path: "memory/topics/archive.md", content: "# Archive\nupdated: 2026-10-14\nverified: unverified\n- A paraphrase only.\n" },
  ], summary: "" };
  const srcs = memorySources(bigFiles, [], new Map());
  expect(() => renderMemoryUpdate(update, bigFiles, srcs, {})).toThrow("does not contain the entry line");
  update.documents[0]!.content += `${entry.line}\n`;
  expect(renderMemoryUpdate(update, bigFiles, srcs, {}).memory).not.toContain(entry.line);
});

test("an over-cap proposal is handed back with the numbers, demoted into a topic, reviewed and applied", async () => {
  writeFileSync(join(root, "MEMORY.md"), longMemory);
  const entries = memoryEntries(bigFiles).filter(e => e.file === "MEMORY.md").slice(0, 4);
  const demote: MemoryUpdate = { operations: [
    ...entries.map(e => ({ op: "remove" as const, id: e.id, reason: "demoted to memory/topics/project-history.md", sources: [] })),
    { op: "link", path: "memory/topics/project-history.md" },
    addition(),
  ], documents: [
    { path: "memory/topics/project-history.md", content: `# Project history\nupdated: 2026-10-14\nverified: unverified\n${entries.map(e => e.line).join("\n")}\n` },
    { path: "memory/catalog.md", content: "# Topics\n- [Project history](memory/topics/project-history.md) — Older project details. Read when: recalling past project work.\n" },
  ], summary: "demoted older details" };
  const prompts: string[] = [];
  const d = deps(upsert());
  d.propose = async (_system, prompt, supplied) => {
    supplied!.set(evidence.id, evidence);
    prompts.push(prompt);
    return { text: JSON.stringify(prompts.length === 1 ? { operations: [addition()], documents: [], summary: "" } : demote), model: "fixture" };
  };
  let reviewed: string[] = [];
  d.review = async (system, prompt) => { reviewed = JSON.parse(prompt).items.map((i: { id: string }) => i.id); return approveAll(system, prompt); };
  const result = await runConsolidation(d, { capture: true });
  expect(result.status).toBe("applied");
  expect(prompts[0]).toContain("Core memory budget");
  expect(prompts[0]).toContain("To demote an entry");
  expect(prompts[1]).toContain("over its 8000-character cap by");
  expect(prompts[1]).toContain(entries[0]!.id);
  // The final update gets the full semantic review: every removal, the link, the addition and both documents.
  expect(reviewed).toHaveLength(entries.length + 4);
  const memory = read("MEMORY.md");
  expect(memory.length).toBeLessThanOrEqual(8000);
  expect(memory).toContain("](memory/topics/project-history.md)");
  expect(memory).not.toContain(entries[0]!.line);
  expect(read("memory/topics/project-history.md")).toContain(entries[0]!.line);
});

test("a proposer that never fits stops after the bounded revisions: skipped, silent, evidence pending", async () => {
  writeFileSync(join(root, "MEMORY.md"), longMemory);
  let proposals = 0;
  const d = deps(upsert());
  d.propose = async (_system, _prompt, supplied) => {
    supplied!.set(evidence.id, evidence); proposals++;
    return { text: JSON.stringify({ operations: [addition()], documents: [], summary: "" }), model: "fixture" };
  };
  d.review = async () => { throw new Error("an over-cap proposal must not be reviewed"); };
  const result = await runConsolidation(d, { capture: true });
  expect(result).toMatchObject({ status: "skipped", alert: "silent" });
  expect(result.summary).toContain("still over its cap");
  expect(proposals).toBe(1 + MAX_CAP_ROUNDS);
  expect(read("MEMORY.md")).toBe(longMemory);
  expect(state().notes).toEqual({});
  expect(state().evidenceCursor).toBeUndefined();
  expect(state().lastRejected).toMatchObject({ count: 1, outcome: "over_cap" });
  expect(read("DREAMS.md")).toContain("deferred (core memory over its cap");
  // Backed off like a rejection, but never reported as one.
  expect((await runConsolidation(d, { capture: true })).summary).toContain("same inputs as the deferred run");
  expect(proposals).toBe(1 + MAX_CAP_ROUNDS);
});
