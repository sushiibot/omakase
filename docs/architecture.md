# Module ownership

The gateway starts in `src/personal.ts`. The workspace starts in `src/workspace/index.ts`.
These entry points assemble services and connect their dependencies.

| Module | Responsibility |
| --- | --- |
| `src/surfaces/web/*Routes.ts` | HTTP input, response codes, and route registration. |
| `src/surfaces/web/application/` | Conversation submission, stop operations, and task coordination. |
| `src/orchestration/workspace/tools.ts` | Tool dispatch, policy, approvals, cancellation, and result handling. |
| `src/orchestration/workspace/toolContributions.ts` | Contribution interfaces and assembly helpers for existing feature adapters. |
| `src/accounts/toolContribution.ts` | Account tools and their feature adapter. |
| `src/workspace/executionTools.ts` | Shared execution tools and their lifecycle. |
| `src/workspace/subagents/` | Subagent sessions and execution state. |
| `src/workspace/piChatSession.ts` | Main chat session construction. |
| `src/workspace/deliveryTransport.ts` | Outbox delivery, acknowledgements, and retries. |
| `src/orchestration/workspace/api.ts` | Typed workspace requests and response validation through an injected request function. |
| `src/orchestration/workspace/link.ts` | Connection state, routing, and composition of the workspace API. |
| `src/orchestration/teamConfig.ts` | Pure team configuration parsing with explicit input values. |

Features can own their contributions, as accounts does. Startup code supplies contributions to `WorkspaceTools`.
New features do not require edits to `toolContributions.ts`.
Maps, location, and the core tool registry remain dependencies of the common dispatcher.

## Enforced boundaries

`scripts/check-architecture.ts` checks these dependencies:

- Orchestration cannot import web implementation modules.
- Web application services cannot import route modules, `chat.ts`, or `server.ts`.
- Subagents and shared execution tools cannot import `piChatSession.ts`.
- The common dispatcher cannot import runtime adapters from accounts, integrations, file stores, or the named machine and task modules.
- The common dispatcher cannot import runtime values from `toolContributions.ts`.
- The workspace API cannot import `link.ts`.
- Delivery transport cannot import runtime values from `personalSession.ts`.

These rules also follow reexport barrels. Runtime rules permit explicit type imports.
The checker rejects runtime cycles and unresolved local imports.
The explicit contract list permits other contracts, SDK types, and runtime imports from `zod` or `zod/v4`.
The list includes `src/accounts/contracts.ts`. Node and Bun imports remain forbidden in contracts.
The team parser cannot depend on runtime configuration, web modules, external runtime packages other than `zod`, or runtime globals.
The global check covers `process`, `Bun`, and `globalThis`.

## Remaining debt

`scripts/architecture-baseline.json` contains exactly three existing orchestration dependencies on web modules:

- `src/orchestration/machines/events.ts` → `src/surfaces/web/pushRules.ts`
- `src/orchestration/transport/server.ts` → `src/surfaces/web/config.ts`
- `src/orchestration/workspace/boot.ts` → `src/surfaces/web/actor.ts`

These dependencies remain migration debt. The gate rejects new violations and stale baseline entries.

## Static limits

The checker starts with production TypeScript files under `src/` and follows resolved local imports.
It recognizes literal imports, exports, `require` calls, and dynamic imports. It does not resolve computed module names or runtime dependency injection.
Boundary traversal follows reexports after the first import. It does not follow arbitrary service dependencies, except for cycle and parser checks.
Route names and feature boundaries are explicit conventions in the checker. New module layouts can require rule updates.
These checks do not prove behavioral correctness or enforce file sizes.

## Commands

Run the boundary fixtures:

```sh
bun test scripts/check-architecture.test.ts
```

Run the repository gate:

```sh
bun run check:architecture
```

Run the application type check:

```sh
bunx tsc --noEmit
```

Run the separate type check for the checker and its fixtures:

```sh
bunx tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --types bun scripts/check-architecture.ts scripts/check-architecture.test.ts
```
