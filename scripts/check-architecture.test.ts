import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { analyze, compareBaseline } from "./check-architecture.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "architecture-"));
  roots.push(root);
  const all = {
    "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "Bundler", module: "ESNext", paths: { "@/*": ["./src/*"] } }, include: ["src/**/*.ts"] }),
    ...files,
  };
  for (const [file, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

describe("backend architecture boundaries", () => {
  test("allows contracts and excludes test-only boundary imports", () => {
    const root = fixture({
      "src/orchestration/worker.ts": 'import { kind } from "../contracts/event.ts";',
      "src/contracts/event.ts": 'export const kind = "ready";',
      "src/orchestration/worker.test.ts": 'import "../surfaces/web/route.ts";',
      "src/surfaces/web/route.ts": 'import { kind } from "../../contracts/event.ts";',
    });
    expect(analyze(root).violations).toEqual([]);
  });

  test("resolves aliases, type-only imports and reexports across the web boundary", () => {
    const root = fixture({
      "src/orchestration/a.ts": 'export type { Shape } from "@/surfaces/web/route";',
      "src/orchestration/b.ts": 'import { type Shape } from "../surfaces/web/route.js";',
      "src/orchestration/c.ts": 'type T = import("../surfaces/web/route").Shape;',
      "src/orchestration/d.ts": 'export * from "../surfaces/web/route";',
      "src/surfaces/web/route.ts": 'export interface Shape {}',
    });
    const result = analyze(root);
    expect(result.violations).toEqual(["a", "b", "c", "d"].map(n => `orchestration-web: src/orchestration/${n}.ts -> src/surfaces/web/route.ts`));
    expect(result.edges.map(e => e.typeOnly)).toEqual([true, true, true, false]);
  });

  test("contracts reject implementation types and runtime dependencies but allow SDK types", () => {
    const root = fixture({
      "src/core/contracts.ts": 'import type { SDK } from "ai"; import type { DB } from "../db/store"; export { run } from "../service"; import "node:fs";',
      "src/db/store.ts": 'export interface DB {}',
      "src/service.ts": 'export function run() {}',
    });
    expect(analyze(root).violations).toEqual([
      "contract-portability: src/core/contracts.ts -> node:fs",
      "contract-portability: src/core/contracts.ts -> src/db/store.ts",
      "contract-portability: src/core/contracts.ts -> src/service.ts",
    ]);
  });

  test("runtime cycles include dynamic imports, require and barrels, but exclude explicit type edges", () => {
    const root = fixture({
      "src/a.ts": 'export * from "./b"; import type { C } from "./c";',
      "src/b.ts": 'void import("./a"); const c = require("./c");',
      "src/c.ts": 'export interface C {}; import { type X } from "./b"; export type { A } from "./a"; export { type B } from "./b";',
    });
    expect(analyze(root).violations).toEqual([
      "runtime-cycle: src/a.ts -> src/b.ts",
      "runtime-cycle: src/b.ts -> src/a.ts",
    ]);
  });

  test("mixed default/type imports stay runtime edges and new edges inside existing cycles fail", () => {
    const root = fixture({
      "src/a.ts": 'import value, { type B } from "./b"; export * from "./c";',
      "src/b.ts": 'export * from "./a"; export * from "./c";',
      "src/c.ts": 'export * from "./a";',
    });
    const baseline = analyze(root).violations;
    writeFileSync(join(root, "src/c.ts"), 'export * from "./a"; export * from "./b";');
    expect(compareBaseline(analyze(root).violations, baseline)).toEqual({
      added: ["runtime-cycle: src/c.ts -> src/b.ts"], stale: [],
    });
    expect(baseline).toContain("runtime-cycle: src/a.ts -> src/b.ts");
  });

  test("pure team parser rejects indirect config loads and environment reads", () => {
    const root = fixture({
      "src/orchestration/teamConfig.ts": 'import "../helper";',
      "src/helper.ts": 'import "./config"; export const value = process["env"].VALUE;',
      "src/config.ts": 'export const config = {};',
    });
    expect(analyze(root).violations).toEqual([
      "config-global: src/orchestration/teamConfig.ts -> src/helper.ts -> process",
      "config-purity: src/orchestration/teamConfig.ts -> src/helper.ts -> src/config.ts",
    ]);
  });

  test("pure parser may use neutral helpers and config types without loading the singleton", () => {
    const root = fixture({
      "src/orchestration/teamConfig.ts": 'import { parse } from "../helper"; import type { Config } from "../config";',
      "src/helper.ts": 'export const parse = (value: string) => value.trim();',
      "src/config.ts": 'export type Config = {}; export const config = process.env;',
    });
    expect(analyze(root).violations).toEqual([]);
  });

  test("missing local imports fail instead of silently erasing an edge", () => {
    const root = fixture({ "src/a.ts": 'export * from "./missing"; export * from "@/missing";' });
    expect(analyze(root).violations).toEqual(["unresolved-local: src/a.ts -> ./missing", "unresolved-local: src/a.ts -> @/missing"]);
  });

  test("baseline rejects both new debt and fixed entries; order is deterministic", () => {
    expect(compareBaseline(["c", "a"], ["b", "a"])).toEqual({ added: ["c"], stale: ["b"] });
    const root = fixture({ "src/z.ts": 'import "./a";', "src/a.ts": 'import "./z";' });
    expect(analyze(root)).toEqual(analyze(root));
  });
});
