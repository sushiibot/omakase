import { appendFile } from "node:fs/promises";

// The subset consumed from Bun 1.4 timing files and Playwright 1.63 JSON reports.
type Suite = {
  title: string;
  specs: { title: string; file: string; line: number; tests: {
    projectName: string; status: string; results: { duration: number; retry: number }[];
  }[] }[];
  suites?: Suite[];
};

function milliseconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Expected a nonnegative duration in milliseconds");
  }
  return value;
}
const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
const cell = (value: string) => value.replace(/[\r\n|]/g, " ").replace(/</g, "&lt;");
function table(rows: { name: string; duration: number; detail?: string }[]): string {
  return ["| File / test | Duration | Details |", "| --- | ---: | --- |",
    ...rows.sort((a, b) => b.duration - a.duration).slice(0, 15)
      .map(row => `| ${cell(row.name)} | ${seconds(row.duration)} | ${cell(row.detail ?? "")} |`),
  ].join("\n");
}

export function summarize(kind: string, data: unknown): string {
  if (kind === "bun") {
    const report = data as { version: number; files: Record<string, unknown> };
    if (report.version !== 1 || !report.files || typeof report.files !== "object" || Array.isArray(report.files)) throw new Error("Invalid Bun timing report");
    const rows = Object.entries(report.files).map(([name, duration]) => ({ name, duration: milliseconds(duration) }));
    return `## Backend file timings\n\n${rows.length} recorded files. Whole-file wall durations; this is not total job elapsed time.\n\nSlowest files:\n\n${table(rows)}\n`;
  }
  if (kind !== "playwright") throw new Error("Expected bun or playwright");
  const report = data as { stats: { duration: number }; suites: Suite[] };
  const elapsed = milliseconds(report.stats.duration);
  let total = 0, attempts = 0, retries = 0, retriedTests = 0, flaky = 0;
  const rows: { name: string; duration: number; detail: string }[] = [];
  function visit(suite: Suite, parents: string[]) {
    const titles = [...parents, suite.title];
    for (const spec of suite.specs) {
      for (const test of spec.tests) {
        const duration = test.results.reduce((sum, result) => sum + milliseconds(result.duration), 0);
        attempts += test.results.length;
        const retryCount = test.results.filter(result => result.retry > 0).length;
        retries += retryCount;
        retriedTests += Number(retryCount > 0);
        flaky += Number(test.status === "flaky");
        total += duration;
        rows.push({ name: `${spec.file}:${spec.line} — ${[...titles.slice(1), spec.title].join(" › ")}${test.projectName ? ` [${test.projectName}]` : ""}`,
          duration, detail: `${test.status}; ${retryCount} retries` });
      }
    }
    for (const child of suite.suites ?? []) visit(child, titles);
  }
  for (const suite of report.suites) visit(suite, []);
  return `## Browser test timings\n\nRunner elapsed: **${seconds(elapsed)}** (report stats; excludes CI installation and later steps).\n\nSummed attempt duration: **${seconds(total)}**, including retries. Parallel attempts overlap, so this sum is not elapsed time.\n\n${rows.length} tests; ${attempts} attempts; ${retries} retry attempts across ${retriedTests} tests; ${flaky} flaky tests.\n\nSlowest tests by summed attempt duration:\n\n${table(rows)}\n`;
}

if (import.meta.main) {
  const [kind, path] = process.argv.slice(2);
  let summary: string;
  try {
    if (!kind || !path) throw new Error("Usage: test-timing-summary.ts bun|playwright report.json");
    summary = summarize(kind, await Bun.file(path).json());
  } catch (error) {
    summary = `Timing summary unavailable: ${cell(String(error))}\n`;
  }
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}
