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

  test("neutral reexport barrels cannot hide web dependencies, including type-only chains", () => {
    const root = fixture({
      "src/orchestration/worker.ts": 'import { route } from "../shared"; import type { Shape } from "../types";',
      "src/shared.ts": 'import { route } from "./surfaces/web/route"; export { route };',
      "src/types.ts": 'export type { Shape } from "@/nested";',
      "src/nested.ts": 'export type { Shape } from "./surfaces/web/route";',
      "src/surfaces/web/route.ts": 'export const route = 1; export interface Shape {}',
    });
    expect(analyze(root).violations).toEqual([
      "orchestration-web: src/orchestration/worker.ts -> src/shared.ts -> src/surfaces/web/route.ts",
      "orchestration-web: src/orchestration/worker.ts -> src/types.ts -> src/nested.ts -> src/surfaces/web/route.ts",
    ]);
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

  test("pure parser rejects destructured, aliased and shorthand runtime globals", () => {
    for (const [source, global] of [
      ['const { env } = process; export const value = env.TEAMS;', "process"],
      ['const runtime = Bun; export const value = runtime.env.TEAMS;', "Bun"],
      ['const runtime = globalThis; export const value = runtime.process.env;', "globalThis"],
      ['export const runtime = { process };', "process"],
    ]) {
      const root = fixture({ "src/orchestration/teamConfig.ts": source! });
      expect(analyze(root).violations).toEqual([
        `config-global: src/orchestration/teamConfig.ts -> src/orchestration/teamConfig.ts -> ${global}`,
      ]);
    }
  });

  test("pure parser accepts global-like property names, shadowed bindings and type references", () => {
    const root = fixture({
      "src/orchestration/teamConfig.ts": `
        type Runtime = typeof process;
        const record = { process: 1, Bun: 2, globalThis: 3 };
        export const value = record.process;
        export function parse(process: { env: string }, Bun: string, globalThis: string) {
          return { process, Bun, globalThis, value: process.env };
        }
        export function local() { const process = { env: "value" }; return process.env; }
        export function keys(value: Record<string, string>) {
          const { process: p, Bun: b, globalThis: g } = value;
          return [p, b, g];
        }
      `,
    });
    expect(analyze(root).violations).toEqual([]);
  });

  test("computed destructuring keys still count as runtime global references", () => {
    const root = fixture({
      "src/orchestration/teamConfig.ts": `
        export function parse(value: Record<string, string>) {
          const { [process.env.KEY!]: selected } = value;
          return selected;
        }
      `,
    });
    expect(analyze(root).violations).toEqual([
      "config-global: src/orchestration/teamConfig.ts -> src/orchestration/teamConfig.ts -> process",
    ]);
  });

  test("missing local imports fail instead of silently erasing an edge", () => {
    const root = fixture({ "src/a.ts": 'export * from "./missing"; export * from "@/missing";' });
    expect(analyze(root).violations).toEqual(["unresolved-local: src/a.ts -> ./missing", "unresolved-local: src/a.ts -> @/missing"]);
  });

  const seams = [
    ["application-route", "src/surfaces/web/application/service.ts", "src/surfaces/web/chat.ts", false],
    ["application-route", "src/surfaces/web/application/service.ts", "src/surfaces/web/taskRoutes.ts", false],
    ["application-route", "src/surfaces/web/application/service.ts", "src/surfaces/web/voice/routes.ts", false],
    ["execution-session", "src/workspace/subagents/host.ts", "src/workspace/piChatSession.ts", false],
    ["execution-session", "src/workspace/executionTools.ts", "src/workspace/piChatSession.ts", false],
    ["dispatcher-feature", "src/orchestration/workspace/tools.ts", "src/accounts/toolContribution.ts", true],
    ["dispatcher-feature", "src/orchestration/workspace/tools.ts", "src/integrations/service.ts", true],
    ["dispatcher-feature", "src/orchestration/workspace/tools.ts", "src/orchestration/workspace/toolContributions.ts", true],
    ["dispatcher-feature", "src/orchestration/workspace/tools.ts", "src/orchestration/workspace/fileStores/service.ts", true],
    ["dispatcher-feature", "src/orchestration/workspace/tools.ts", "src/orchestration/machines/control.ts", true],
    ["dispatcher-feature", "src/orchestration/workspace/tools.ts", "src/orchestration/machines/agents.ts", true],
    ["dispatcher-feature", "src/orchestration/workspace/tools.ts", "src/orchestration/taskManifest.ts", true],
    ["workspace-api-link", "src/orchestration/workspace/api.ts", "src/orchestration/workspace/link.ts", false],
    ["delivery-session", "src/workspace/deliveryTransport.ts", "src/workspace/personalSession.ts", true],
  ] as const;

  for (const [rule, from, to, runtimeOnly] of seams) {
    test(`${rule} guards ${from} -> ${to}, directly and through barrels`, () => {
      const alias = `@/${to.slice(4, -3)}`;
      for (const viaBarrel of [false, true]) {
        for (const typeOnly of [false, true]) {
          const source = viaBarrel ? "@/barrel" : alias;
          const root = fixture({
            [from]: `import ${typeOnly ? "type " : ""}{ value } from "${source}";`,
            [to]: "export const value = 1;",
            "src/barrel.ts": `import { value } from "${alias}"; export { value };`,
          });
          expect(analyze(root).violations).toEqual(runtimeOnly && typeOnly ? [] : [
            `${rule}: ${from} -> ${viaBarrel ? "src/barrel.ts -> " : ""}${to}`,
          ]);
        }
      }
    });
  }

  test("runtime boundaries allow type-only barrels and ordinary composition", () => {
    const root = fixture({
      "src/orchestration/workspace/tools.ts": 'import { value } from "@/composition"; import { Shape } from "@/types"; import "./maps"; import "./location"; import "../../core/tools/registry";',
      "src/composition.ts": 'import { value } from "./accounts/toolContribution"; export const service = () => value;',
      "src/types.ts": 'export type { Shape } from "./accounts/toolContribution";',
      "src/accounts/toolContribution.ts": 'export const value = 1; export interface Shape {}',
      "src/orchestration/workspace/maps.ts": "export {};",
      "src/orchestration/workspace/location.ts": "export {};",
      "src/core/tools/registry.ts": "export {};",
      "src/surfaces/web/application/service.ts": 'import "../events"; import "../workspaceAdapter";',
      "src/surfaces/web/events.ts": "export {};",
      "src/surfaces/web/workspaceAdapter.ts": "export {};",
      "src/workspace/subagents/host.ts": 'import "../executionTools";',
      "src/workspace/executionTools.ts": "export {};",
      "src/orchestration/workspace/link.ts": 'import "./api";',
      "src/orchestration/workspace/api.ts": "export {};",
      "src/workspace/personalSession.ts": 'import "./deliveryTransport";',
      "src/workspace/deliveryTransport.ts": "export {};",
    });
    expect(analyze(root).violations).toEqual([]);
  });

  test("account contracts allow zod/v4 but reject account service imports", () => {
    const root = fixture({
      "src/accounts/contracts.ts": 'import { z } from "zod/v4"; import type { SDK } from "ai";',
      "src/accounts/service.ts": "export interface Service {}",
    });
    expect(analyze(root).violations).toEqual([]);
    writeFileSync(join(root, "src/accounts/contracts.ts"), 'import type { Service } from "./service";');
    expect(analyze(root).violations).toEqual([
      "contract-portability: src/accounts/contracts.ts -> src/accounts/service.ts",
    ]);
  });

  test("baseline rejects both new debt and fixed entries; order is deterministic", () => {
    expect(compareBaseline(["c", "a"], ["b", "a"])).toEqual({ added: ["c"], stale: ["b"] });
    const root = fixture({ "src/z.ts": 'import "./a";', "src/a.ts": 'import "./z";' });
    expect(analyze(root)).toEqual(analyze(root));
  });
});
