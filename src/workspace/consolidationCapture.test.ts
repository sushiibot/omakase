import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConsolidation, type ConsolidationDeps } from "./consolidation.ts";
import type { Evidence, MemoryEvidence } from "./memoryEvidence.ts";

const T0 = Date.parse("2026-11-07T12:00:00Z");
const MIN = 60_000;

class FakeEvidence {
  records: Evidence[] = [];
  constructor(public generation = "gen-1") {}
  async refresh() {}
  add(role: "user" | "assistant", atMs: number) {
    const seq = this.records.length + 1;
    this.records.push({ id: seq.toString(16).padStart(24, "0"), role, source: "sessions/chat/a.jsonl", tag: role === "user" ? `(src: 2026-11-07, web:${seq})` : null, text: `turn ${seq}`, at: new Date(atMs).toISOString(), seq, part: 0, parts: 1 });
  }
  pending(after: number) {
    const records = this.records.filter((r) => r.seq > after).slice(0, 100);
    return { records, cursor: records.at(-1)?.seq ?? after };
  }
  activity(after: number) {
    const rows = this.records.filter((r) => r.seq > after);
    return { ownerTurns: rows.filter((r) => r.role === "user" && r.tag).length, lastAt: rows.map((r) => r.at).sort().at(-1) ?? null };
  }
  latestSequence() { return this.records.at(-1)?.seq ?? 0; }
  tools() { return []; }
}

let root: string;
let now: number;
let proposals: number;
let evidence: FakeEvidence;
let fail: boolean;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "capture-gate-"));
  mkdirSync(join(root, "home/memory"), { recursive: true });
  now = T0;
  proposals = 0;
  fail = false;
  evidence = new FakeEvidence();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function deps(): ConsolidationDeps {
  return {
    home: join(root, "home"),
    stateDir: join(root, "state"),
    evidence: evidence as unknown as MemoryEvidence,
    now: () => new Date(now),
    propose: async () => {
      proposals++;
      if (fail) throw new Error("402: Insufficient credits");
      return { text: "not a proposal", model: "fixture" };
    },
    commit: async () => ({ committed: false }),
  };
}
const capture = () => runConsolidation(deps(), { capture: true });

test("an existing backlog of owner turns is a baseline, not a reason to capture every tick", async () => {
  for (let i = 0; i < 5; i++) evidence.add("user", T0 - 3 * 24 * 60 * MIN);
  expect((await capture()).summary).toContain("baseline");
  for (let i = 0; i < 3; i++) {
    now += 5 * MIN;
    expect((await capture()).summary).toContain("no new conversation");
  }
  expect(proposals).toBe(0);
});

test("a new owner turn captures once it has been quiet, then waits for the next one", async () => {
  evidence.add("user", T0 - 60 * MIN);
  await capture();
  evidence.add("user", T0 + MIN);
  evidence.add("assistant", T0 + 2 * MIN);
  now = T0 + 10 * MIN;
  expect((await capture()).summary).toContain("deferred: conversation active");
  now = T0 + 25 * MIN;
  await capture();
  expect(proposals).toBe(1);
  now += 5 * MIN;
  expect((await capture()).summary).toContain("no new conversation");
  expect(proposals).toBe(1);
});

test("a failed model call is not retried on the next tick", async () => {
  await capture();
  evidence.add("user", T0 + MIN);
  now = T0 + 30 * MIN;
  fail = true;
  await expect(capture()).rejects.toThrow("402");
  for (let i = 0; i < 3; i++) {
    now += 5 * MIN;
    expect((await capture()).status).toBe("skipped");
  }
  expect(proposals).toBe(1);
});

test("a rebuilt index records a new baseline instead of replaying its history", async () => {
  evidence.add("user", T0 - 60 * MIN);
  await capture();
  evidence = new FakeEvidence("gen-2");
  for (let i = 0; i < 4; i++) evidence.add("user", T0 - 60 * MIN);
  now += 5 * MIN;
  expect((await capture()).summary).toContain("baseline");
  now += 5 * MIN;
  expect((await capture()).summary).toContain("no new conversation");
  expect(proposals).toBe(0);
});

test("forced and nightly runs still work through the backlog", async () => {
  evidence.add("user", T0 - 60 * MIN);
  await capture();
  await runConsolidation(deps());
  expect(proposals).toBe(1);
});
