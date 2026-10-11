import { expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

/** Owner-only personal agent: web app, workspace control plane and container. */
const PERSONAL = [
  "src/personal.ts",
  "src/surfaces/web/**",
  "src/workspace/**",
  "src/agentRuntime/**",
  "src/orchestration/workspace/**",
  "src/orchestration/transport/**",
  "src/orchestration/github/**",
  "src/orchestration/{contracts,sessionContracts,taskContracts,browserContracts,memoryContracts}.ts",
  "src/db/workspaceLink.ts",
];

/** Non-personal files the personal side may import; copied into the personal repo when it is extracted. */
const SHARED = [
  "src/logger.ts",
  "src/config.ts",
  "src/telemetry.ts",
  "src/crashBackoff.ts",
  "src/db/index.ts",
  "src/db/schema.ts",
  "src/core/contracts.ts",
  "src/core/agentCore.ts",
  "src/core/tools/registry.ts",
  "src/core/stores/**",
  "src/agent/transcribe.ts",
  "src/agent/transcriptionAudio.ts",
  "src/orchestration/{principals,authz,teams,teamConfig}.ts",
  "src/utils/**",
];

/** TEMPORARY: the personal-entrypoint unit splits these files. Empty this list once it lands. */
const TEMPORARY_EXEMPT = ["src/index.ts", "src/config.ts", "src/surfaces/discord/breakGlass.ts"];

const ROOT = resolve(import.meta.dir, "..");

const matches = (patterns: string[], path: string) => patterns.some((p) => new Bun.Glob(p).match(path));
/** A test file sits on the same side as the file it tests, e.g. `contracts.test.ts` with `contracts.ts`. */
const isPersonal = (path: string) => matches(PERSONAL, path.replace(/(\.\w+)?\.test\.ts$/, ".ts"));

const isFile = (path: string) => existsSync(path) && statSync(path).isFile();

/** The file a relative specifier loads, or null when nothing exists there (the test then fails). */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  const base = resolve(ROOT, dirname(fromFile), specifier);
  const candidates = [base.replace(/\.js$/, ".ts"), base, `${base}.ts`, join(base, "index.ts")];
  const found = candidates.find(isFile);
  return found ? relative(ROOT, found) : null;
}

test("community and personal code import across the boundary only through the shared list", () => {
  if (TEMPORARY_EXEMPT.length) console.warn(`boundary: TEMPORARY_EXEMPT skips ${TEMPORARY_EXEMPT.join(", ")}; empty it once the personal entrypoint split lands.`);
  const violations: string[] = [];
  for (const file of new Bun.Glob("src/**/*.ts").scanSync({ cwd: ROOT })) {
    if (TEMPORARY_EXEMPT.includes(file)) continue;
    const personal = isPersonal(file);
    const { importedFiles } = ts.preProcessFile(readFileSync(join(ROOT, file), "utf8"), true, true);
    for (const { fileName: specifier } of importedFiles) {
      if (!specifier.startsWith(".")) continue;
      const target = resolveSpecifier(file, specifier);
      if (!target) {
        violations.push(`${file} → "${specifier}" (relative import does not resolve to a file; the boundary can't classify it)`);
        continue;
      }
      if (!target.startsWith("src/")) continue;
      const targetPersonal = isPersonal(target);
      if (!personal && targetPersonal) violations.push(`${file} → "${specifier}" (community must not import personal)`);
      if (personal && !targetPersonal && !matches(SHARED, target))
        violations.push(`${file} → "${specifier}" (personal may import only personal or shared files; ${target} is neither)`);
    }
  }
  if (violations.length) {
    const note = `TEMPORARY_EXEMPT still skips ${TEMPORARY_EXEMPT.join(", ")}; empty it once the personal entrypoint split lands.`;
    throw new Error(`Import boundary violations:\n${violations.join("\n")}\n\n${note}`);
  }
  expect(violations).toEqual([]);
});
