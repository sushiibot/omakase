/** Backend boundary gate. Keep contracts portable; inject surface adapters into orchestration.
 * Pure parsers belong in src/orchestration/teamConfig.ts and take environment values as arguments.
 * Only production src files are roots. Type-only edges count for boundaries, not cycles.
 * The baseline is an exact debt inventory: remove fixed entries; never refresh it to hide new debt.
 */
import ts from "typescript";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

export interface Edge { from: string; to: string; typeOnly: boolean }
const portableContracts = new Set([
  "src/core/contracts.ts", "src/orchestration/contracts.ts",
  "src/orchestration/machines/contracts.ts",
  ...["artifact", "browser", "maintenance", "maps", "memory", "session", "task"].map(
    (name) => `src/orchestration/${name}Contracts.ts`,
  ),
]);
const isContract = (file: string) => portableContracts.has(file) || file.startsWith("src/contracts/");
const isPureConfig = (file: string) => file === "src/orchestration/teamConfig.ts";
const production = (file: string) => !/\.(test|spec|d)\.[cm]?tsx?$/.test(file);

export function analyze(root: string): { edges: Edge[]; violations: string[] } {
  root = resolve(root);
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) throw new Error("Missing tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  if (parsed.errors.length) throw new Error(parsed.errors.map(e => ts.flattenDiagnosticMessageText(e.messageText, "\n")).join("\n"));
  const name = (path: string) => relative(root, path).replaceAll("\\", "/");
  const files = ts.sys.readDirectory(resolve(root, "src"), [".ts", ".tsx", ".mts", ".cts"], ["**/node_modules/**"]).filter(production).sort();
  const edges: Edge[] = [];
  const violations = new Set<string>();
  const visited = new Set<string>();
  const globals = new Map<string, Set<string>>();
  // Follow resolved local dependencies too, so an intermediary cannot conceal a runtime cycle.
  const queue = [...files];
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index]!;
    if (visited.has(path)) continue;
    visited.add(path);
    const from = name(path);
    const source = ts.sys.readFile(path);
    if (source === undefined) throw new Error(`Cannot read ${from}`);
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const add = (specifier: string, typeOnly: boolean) => {
      const resolved = ts.resolveModuleName(specifier, path, parsed.options, ts.sys).resolvedModule;
      const local = resolved && !resolved.isExternalLibraryImport && !name(resolved.resolvedFileName).startsWith("../");
      const to = local ? name(resolved.resolvedFileName) : specifier;
      const alias = Object.keys(parsed.options.paths ?? {}).some(pattern => {
        const star = pattern.indexOf("*");
        return star < 0 ? pattern === specifier : specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1));
      });
      if (!resolved && (specifier.startsWith(".") || specifier.startsWith("#") || alias)) {
        violations.add(`unresolved-local: ${from} -> ${specifier}`);
      }
      edges.push({ from, to, typeOnly });
      if (local && production(resolved.resolvedFileName)) queue.push(resolved.resolvedFileName);
      if (from.startsWith("src/orchestration/") && (to.startsWith("src/surfaces/web/") || to.startsWith("web/"))) {
        violations.add(`orchestration-web: ${from} -> ${to}`);
      }
      // Explicit wire contracts, not every file called types.ts: SDK type dependencies are portable.
      if (isContract(from) && (local ? !isContract(to) : (!typeOnly && specifier !== "zod") || /^(node:|bun(?:$|:))/.test(specifier))) {
        violations.add(`contract-portability: ${from} -> ${to}`);
      }

    };
    const walk = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const bindings = clause?.namedBindings;
        const typeOnly = !!clause?.isTypeOnly || (!!clause && !clause.name && !!bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(e => e.isTypeOnly));
        add(node.moduleSpecifier.text, typeOnly);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.exportClause;
        add(node.moduleSpecifier.text, node.isTypeOnly || (!!clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every(e => e.isTypeOnly)));
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
        add(node.moduleReference.expression.text, node.isTypeOnly);
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        add(node.argument.literal.text, true);
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteralLike(argument)) add(argument.text, false);
      }
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && ts.isIdentifier(node.expression) && ["process", "Bun", "globalThis"].includes(node.expression.text)) {
        const entries = globals.get(from) ?? new Set<string>();
        entries.add(node.expression.text);
        globals.set(from, entries);
      }
      ts.forEachChild(node, walk);
    };
    walk(ast);
  }
  // Inventory each edge participating in a cycle, rather than SCC names: adding an edge
  // inside an existing SCC must fail, too. Traversal order never affects the baseline.
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges.filter(e => !e.typeOnly)) {
    const targets = adjacency.get(edge.from) ?? new Set<string>();
    targets.add(edge.to);
    adjacency.set(edge.from, targets);
  }
  const reaches = (start: string, target: string, seen = new Set<string>()): boolean => {
    if (start === target) return true;
    if (seen.has(start)) return false;
    seen.add(start);
    return [...(adjacency.get(start) ?? [])].some(next => reaches(next, target, seen));
  };
  for (const parser of [...visited].map(name).filter(isPureConfig)) {
    for (const edge of edges.filter(e => !e.typeOnly && reaches(parser, e.from))) {
      if (/(?:^|\/)config\.ts$/.test(edge.to) || edge.to.startsWith("src/surfaces/web/") || (!visited.has(resolve(root, edge.to)) && edge.to !== "zod")) {
        violations.add(`config-purity: ${parser} -> ${edge.from} -> ${edge.to}`);
      }
    }
    for (const [file, names] of globals) if (reaches(parser, file)) {
      for (const global of names) violations.add(`config-global: ${parser} -> ${file} -> ${global}`);
    }
  }
  for (const [from, targets] of adjacency) for (const to of targets) {
    if (reaches(to, from)) violations.add(`runtime-cycle: ${from} -> ${to}`);
  }
  return { edges: edges.sort((a, b) => `${a.from}:${a.to}:${a.typeOnly}`.localeCompare(`${b.from}:${b.to}:${b.typeOnly}`)), violations: [...violations].sort() };
}

export function compareBaseline(actual: string[], baseline: string[]) {
  const current = new Set(actual);
  const previous = new Set(baseline);
  return {
    added: [...current].filter(entry => !previous.has(entry)).sort(),
    stale: [...previous].filter(entry => !current.has(entry)).sort(),
  };
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const actual = analyze(root).violations;
  const baseline: unknown = JSON.parse(readFileSync(resolve(root, "scripts/architecture-baseline.json"), "utf8"));
  if (!Array.isArray(baseline) || baseline.some(entry => typeof entry !== "string") || new Set(baseline).size !== baseline.length) throw new Error("Baseline must contain unique violation strings");
  const { added, stale } = compareBaseline(actual, baseline);
  if (added.length || stale.length) {
    for (const entry of added) console.error(`NEW ${entry}`);
    for (const entry of stale) console.error(`REMOVE FIXED BASELINE ENTRY ${entry}`);
    process.exitCode = 1;
  } else console.log(`Architecture checks passed (${actual.length} existing violations).`);
}
