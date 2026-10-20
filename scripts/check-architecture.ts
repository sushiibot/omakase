/** Backend boundary gate. Keep contracts portable; inject surface adapters into orchestration.
 * Pure parsers belong in src/orchestration/teamConfig.ts and take environment values as arguments.
 * Only production src files are roots. Type-only edges count for boundaries, not cycles.
 * The baseline is an exact debt inventory: remove fixed entries; never refresh it to hide new debt.
 */
import ts from "typescript";
import { isBuiltin } from "node:module";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

export interface Edge { from: string; to: string; typeOnly: boolean }
const portableContracts = new Set([
  "src/core/contracts.ts", "src/orchestration/contracts.ts", "src/accounts/contracts.ts",
  "src/orchestration/machines/contracts.ts",
  ...["artifact", "block", "browser", "maintenance", "maps", "memory", "saved", "session", "task"].map(
    (name) => `src/orchestration/${name}Contracts.ts`,
  ),
]);
// Concrete landed boundaries. Runtime-only rules permit interface imports.
const boundaryRules = [
  { id: "application-route", runtimeOnly: false,
    source: (file: string) => file.startsWith("src/surfaces/web/application/"),
    target: (file: string) => /^src\/surfaces\/web\/(?:.*Routes|voice\/routes|chat|server)\.ts$/.test(file) },
  { id: "execution-session", runtimeOnly: false,
    source: (file: string) => file.startsWith("src/workspace/subagents/") || file === "src/workspace/executionTools.ts",
    target: (file: string) => file === "src/workspace/piChatSession.ts" },
  { id: "dispatcher-feature", runtimeOnly: true,
    source: (file: string) => file === "src/orchestration/workspace/tools.ts",
    target: (file: string) => file.startsWith("src/accounts/") || file.startsWith("src/integrations/")
      || file.startsWith("src/orchestration/workspace/fileStores/")
      || ["src/orchestration/workspace/toolContributions.ts", "src/orchestration/machines/control.ts",
        "src/orchestration/machines/agents.ts", "src/orchestration/taskManifest.ts"].includes(file) },
  { id: "workspace-api-link", runtimeOnly: false,
    source: (file: string) => file === "src/orchestration/workspace/api.ts",
    target: (file: string) => file === "src/orchestration/workspace/link.ts" },
  { id: "delivery-session", runtimeOnly: true,
    source: (file: string) => file === "src/workspace/deliveryTransport.ts",
    target: (file: string) => file === "src/workspace/personalSession.ts" },
];
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
  const reexports = new Map<string, Set<string>>();
  const runtimeReexports = new Map<string, Set<string>>();
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
    const add = (specifier: string, typeOnly: boolean, reexport = false) => {
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
      if (reexport) {
        const targets = reexports.get(from) ?? new Set<string>();
        targets.add(to);
        reexports.set(from, targets);
        if (!typeOnly) {
          const runtimeTargets = runtimeReexports.get(from) ?? new Set<string>();
          runtimeTargets.add(to);
          runtimeReexports.set(from, runtimeTargets);
        }
      }
      if (local && production(resolved.resolvedFileName)) queue.push(resolved.resolvedFileName);
      if (from.startsWith("src/orchestration/") && (to.startsWith("src/surfaces/web/") || to.startsWith("web/"))) {
        violations.add(`orchestration-web: ${from} -> ${to}`);
      }
      // Explicit wire contracts, not every file called types.ts: SDK type dependencies are portable.
      if (isContract(from) && (local ? !isContract(to) : (!typeOnly && !["zod", "zod/v4"].includes(specifier)) || (isBuiltin(specifier) || /^(node:|bun(?:$|:))/.test(specifier)))) {
        violations.add(`contract-portability: ${from} -> ${to}`);
      }

    };
    // Also recognize split barrels: import { x } from "..."; export { x }.
    const imported = new Map<string, { specifier: string; typeOnly: boolean }>();
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const clause = statement.importClause;
      if (!clause) continue;
      const specifier = statement.moduleSpecifier.text;
      if (clause.name) imported.set(clause.name.text, { specifier, typeOnly: clause.isTypeOnly });
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) imported.set(bindings.name.text, { specifier, typeOnly: clause.isTypeOnly });
      if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
        imported.set(binding.name.text, { specifier, typeOnly: clause.isTypeOnly || binding.isTypeOnly });
      }
    }
    const walk = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const bindings = clause?.namedBindings;
        const typeOnly = !!clause?.isTypeOnly || (!!clause && !clause.name && !!bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(e => e.isTypeOnly));
        add(node.moduleSpecifier.text, typeOnly);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.exportClause;
        add(node.moduleSpecifier.text, node.isTypeOnly || (!!clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every(e => e.isTypeOnly)), true);
      } else if (ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const binding of node.exportClause.elements) {
          const source = imported.get((binding.propertyName ?? binding.name).text);
          if (source) add(source.specifier, source.typeOnly || node.isTypeOnly || binding.isTypeOnly, true);
        }
      } else if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) {
        const source = imported.get(node.expression.text);
        if (source) add(source.specifier, source.typeOnly, true);
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
        add(node.moduleReference.expression.text, node.isTypeOnly);
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        add(node.argument.literal.text, true);
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteralLike(argument)) add(argument.text, false);
      }
      ts.forEachChild(node, walk);
    };
    walk(ast);
  }
  // A neutral barrel must not hide web implementation provenance. Follow only
  // reexports after the first edge: ordinary service composition is not a barrel.
  const followBarrel = (path: string[]) => {
    const last = path.at(-1)!;
    if (path.length > 2 && (last.startsWith("src/surfaces/web/") || last.startsWith("web/"))) {
      violations.add(`orchestration-web: ${path.join(" -> ")}`);
      return;
    }
    for (const next of reexports.get(last) ?? []) {
      if (!path.includes(next)) followBarrel([...path, next]);
    }
  };
  for (const edge of edges) if (edge.from.startsWith("src/orchestration/")) {
    followBarrel([edge.from, edge.to]);
  }
  // Follow reexports, not arbitrary service dependencies, for each owned boundary.
  for (const rule of boundaryRules) {
    const barrels = rule.runtimeOnly ? runtimeReexports : reexports;
    const follow = (path: string[]) => {
      const last = path.at(-1)!;
      if (rule.target(last)) {
        violations.add(`${rule.id}: ${path.join(" -> ")}`);
        return;
      }
      for (const next of barrels.get(last) ?? []) {
        if (!path.includes(next)) follow([...path, next]);
      }
    };
    for (const edge of edges) {
      if (rule.source(edge.from) && (!rule.runtimeOnly || !edge.typeOnly)) follow([edge.from, edge.to]);
    }
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
  const parsers = [...visited].map(name).filter(isPureConfig);
  // Resolve symbols to distinguish runtime globals from object keys, parameters,
  // local bindings and type references. The latter are safe in a pure parser.
  const globals = new Map<string, Set<string>>();
  if (parsers.length) {
    const program = ts.createProgram(parsers.map(file => resolve(root, file)), parsed.options);
    const checker = program.getTypeChecker();
    for (const source of program.getSourceFiles()) {
      const file = name(source.fileName);
      if (!parsers.some(parser => reaches(parser, file))) continue;
      const walk = (node: ts.Node) => {
        if (ts.isTypeNode(node)) return;
        if (ts.isIdentifier(node) && ["process", "Bun", "globalThis"].includes(node.text)) {
          const parent = node.parent;
          const propertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node)
            || (ts.isBindingElement(parent) && parent.propertyName === node);
          const symbol = ts.isShorthandPropertyAssignment(parent)
            ? checker.getShorthandAssignmentValueSymbol(parent)
            : checker.getSymbolAtLocation(node);
          const local = symbol?.declarations?.some(declaration => !declaration.getSourceFile().isDeclarationFile);
          if (!propertyName && !local) {
            const entries = globals.get(file) ?? new Set<string>();
            entries.add(node.text);
            globals.set(file, entries);
          }
        }
        ts.forEachChild(node, walk);
      };
      walk(source);
    }
  }
  for (const parser of parsers) {
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
