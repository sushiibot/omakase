import { expect, test } from "bun:test";
import { summarize } from "./test-timing-summary.ts";

test("Bun reports sort whole-file wall milliseconds, including zero", () => {
  const summary = summarize("bun", { version: 1, files: { "fast.ts": 0, "slow.ts": 1234 } });
  expect(summary).toContain("2 recorded files");
  expect(summary.indexOf("slow.ts")).toBeLessThan(summary.indexOf("fast.ts"));
  expect(summary).toContain("1.23 s");
  expect(summary).toContain("not total job elapsed time");
});

test("nested browser suites sum attempts, count retries, and keep elapsed separate", () => {
  const summary = summarize("playwright", { stats: { duration: 2000 }, suites: [{ title: "a.spec.ts", specs: [], suites: [
    { title: "group", specs: [{ title: "retried | test", file: "a.spec.ts", line: 4, tests: [
      { projectName: "chromium", status: "flaky", results: [{ duration: 1500, retry: 0 }, { duration: 1000, retry: 1 }, { duration: 500, retry: 2 }] },
      { projectName: "other", status: "expected", results: [{ duration: 1000, retry: 0 }] },
      { projectName: "skipped", status: "skipped", results: [] },
    ] }] },
  ] }] });
  expect(summary).toContain("Runner elapsed: **2.00 s**");
  expect(summary).toContain("Summed attempt duration: **4.00 s**");
  expect(summary).toContain("3 tests; 4 attempts; 2 retry attempts across 1 tests; 1 flaky tests");
  expect(summary).toContain("group › retried   test [chromium] | 3.00 s | flaky; 2 retries");
  expect(summary).toContain("not elapsed time");
});

test("invalid durations and report versions are rejected", () => {
  expect(() => summarize("bun", { version: 2, files: {} })).toThrow();
  expect(() => summarize("bun", { version: 1, files: "123" })).toThrow();
  expect(() => summarize("bun", { version: 1, files: { x: -1 } })).toThrow();
  expect(() => summarize("playwright", { stats: { duration: "10" }, suites: [] })).toThrow();
});

test("missing reports do not fail the reporting command", async () => {
  const result = Bun.spawn(["bun", "scripts/test-timing-summary.ts", "bun", "/tmp/omakase-nonexistent-timing-report.json"], {
    stdout: "pipe", stderr: "pipe", env: { ...process.env, GITHUB_STEP_SUMMARY: "" },
  });
  expect(await result.exited).toBe(0);
  expect(await new Response(result.stdout).text()).toContain("Timing summary unavailable");
});
