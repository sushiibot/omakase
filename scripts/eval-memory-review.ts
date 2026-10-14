import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorkspaceConfig } from "../src/workspace/config.ts";
import { BackendSelector } from "../src/workspace/chatgptFallback.ts";
import { RunLog } from "../src/workspace/runLog.ts";
import { runToolFreeJob } from "../src/workspace/jobSession.ts";
import { MEMORY_REVIEW_SYSTEM, reviewItems, reviewProblems } from "../src/workspace/memoryUpdates.ts";
import { MEMORY_REVIEW_CASES, memoryReviewCaseInput } from "../src/workspace/fixtures/memory-review.ts";

if (process.argv.includes("--list")) {
  for (const c of MEMORY_REVIEW_CASES) console.log(`${c.accept ? "accept" : "reject"}: ${c.name}`);
} else {
  if (!process.env.OPENAI_API_KEY) throw new Error("Set OPENAI_API_KEY to an OpenRouter key. WORKSPACE_MODEL selects the reviewer. This evaluation makes paid model calls using synthetic data.");
  const root = mkdtempSync(join(tmpdir(), "memory-review-eval-"));
  try {
    const base = loadWorkspaceConfig({ ...process.env, ORCH_SECRET: "evaluation-only" });
    const config = { ...base, provider: "openrouter" as const, home: root, stateDir: join(root, "state"), agentDir: join(root, "agent") };
    const selector = new BackendSelector({ primaryEnabled: false });
    const runs = new RunLog(config.stateDir);
    let falseAccept = 0, falseReject = 0, errors = 0;
    for (const c of MEMORY_REVIEW_CASES) {
      const { update, context } = memoryReviewCaseInput(c);
      try {
        const result = await runToolFreeJob(config, { agentName: "job:memory-review-eval", systemPrompt: MEMORY_REVIEW_SYSTEM,
          prompt: JSON.stringify({ ...context, items: reviewItems(update) }), runs, selector });
        const problems = reviewProblems(result.text, update);
        const accepted = problems.length === 0;
        if (accepted && !c.accept) falseAccept++;
        if (!accepted && c.accept) falseReject++;
        console.log(JSON.stringify({ case: c.name, model: result.model, expected: c.accept, accepted, problems }));
      } catch (error) { errors++; console.error(JSON.stringify({ case: c.name, error: error instanceof Error ? error.message : String(error) })); }
    }
    console.log(JSON.stringify({ cases: MEMORY_REVIEW_CASES.length, falseAccept, falseReject, errors }));
    if (falseAccept || falseReject || errors) process.exitCode = 1;
  } finally { rmSync(root, { recursive: true, force: true }); }
}
