# omakase

A self-hosted, owner-only personal agent: a SvelteKit PWA, the gateway that serves it, and a
long-lived workspace container where the agent runs. The app is meant to be served on a private
network (e.g. a tailnet) behind a reverse proxy that authenticates the owner. It was split out of
sushii-agent.

| Part | Entry | Runs as |
|---|---|---|
| Gateway: web app server, chat routing, push, workspace control plane, proxied tools | `src/personal.ts` | image `ghcr.io/sushiibot/omakase:<sha>` |
| Workspace: Pi coding-agent sessions, subagents, memory, scheduled jobs | `src/workspace/index.ts` | image `ghcr.io/sushiibot/omakase:<sha>-workspace` (Dockerfile target `workspace`) |
| Machine daemon: remote file and session access on the owner's machines | `src/workspace/machine/index.ts` | `bun run machine` on each machine (`docs/machines.md`) |
| Web app | `web/` | built into the gateway image (`web/README.md`) |

## Development

```bash
bun install
bun dev                       # gateway, ./data/personal.db
bunx tsc --noEmit
OPENAI_API_KEY=dummy bun test
bun run e2e:system            # gateway + workspace + web app + fake model (e2e-system/README.md)
```

Web app checks run from `web/`; see `AGENTS.md` (`CLAUDE.md` is a symlink to it).

## Gateway configuration

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | required | OpenRouter key for dictation and voice transcription |
| `OPENAI_BASE_URL` | `https://api.anthropic.com/v1` | OpenAI-compatible endpoint (production: OpenRouter) |
| `DATABASE_PATH` | `./data/personal.db` | SQLite path; migrations in `drizzle/` apply at boot |
| `PRINCIPALS_PATH` | `./principals.json` | Identity registry; the owner principal maps its `web` login |
| `OWNER_DISCORD_ID` | none | Synthesizes the owner principal when `principals.json` is absent; proxied tools run as this id |
| `TEAMS_PATH` | `./teams.json` | Team grouping (shape: `src/orchestration/teams.ts`); routes Linear issues per team |
| `EXA_API_KEY`, `GRAFANA_BASE_URL`, `GRAFANA_API_TOKEN`, `LINEAR_API_KEY`, `LINEAR_TEAM_ID` | none | Proxied tools; each is offered only when configured |
| `ORCH_PORT`, `ORCH_SECRET` | `8788`, none | Workspace transport; the workspace presents the same secret |
| `SUSHII_MACHINES_JSON` | `[]` | Machine daemon grants (`docs/machines.md`) |
| `DM_WORKSPACE_ENABLED` | `false` | Routes web chat to the workspace and enables its tool manifest |
| `WEB_OWNER_LOGIN`, `WEB_PORT`, `WEB_BIND_ADDR`, `WEB_TRUSTED_PEERS`, `WEB_DIST_DIR`, `WEB_UPLOADS_DIR` | web server off without a login | Web gateway; it trusts `Tailscale-User-Login` only from the trusted peers |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | none | Web push |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_BOT_NAME`, `GITHUB_BOT_EMAIL` | none | GitHub App tokens for the workspace |
| `DASHSCOPE_*`, `GEMINI_API_KEY`, `OPENAI_REALTIME_API_KEY` | none | Optional live voice providers (`.env.example`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | none | Enables OpenTelemetry export |

Workspace settings (`WORKSPACE_*`, `ORCH_URL`) and their defaults are in `src/workspace/config.ts`.

## Deployment

Every push to `main` runs the gates in `.github/workflows/ci.yml` (`typecheck`, `test`, `web`,
`web-e2e`, `browser-smoke`, `e2e-system`), builds the `ghcr.io/sushiibot/omakase:<sha>` and
`:<sha>-workspace` images, and deploys the gateway, then the workspace.

## Workspace

The web chat goes to a long-lived Pi coding-agent session in the workspace container
(`src/workspace/`). The gateway is the transport: it relays chat over a JSON-RPC WebSocket
(`src/orchestration/workspace/`), proxies the tools that need its keys (Exa, Grafana, Linear) with
owner approval for writes, and mints GitHub App tokens so `git`/`gh` run as the configured GitHub App bot.
If the workspace is down, web messages wait and are resent once it reconnects.

- **Home** (`/data/home`, git-versioned): `AGENTS.md`, `SOUL.md`, `USER.md`, `MEMORY.md`, `TASKS.md`
  and `memory/catalog.md` are loaded into every chat session. The catalog has a 4000-character cap.
  Durable decisions and research live in `memory/topics/<slug>.md`, with sources and verification dates.
  Topic bodies, daily notes, `tasks/<project>.md` and `DREAMS.md` are read on demand.
  The agent consults relevant notes before substantial work and updates changed guidance before its final reply.
  Catalog edits refresh the live prompt after a turn settles. Topic files use the existing memory guards and Git commits.
  Unedited template files upgrade themselves on start.
- **Models:** ChatGPT sign-in first (main, subagents, jobs and the auto-mode judge share one
  backend), OpenRouter when the subscription is out.
- **Context:** old tool output is cleared at 150K tokens; compaction (anchored summary, sent as a
  cached continuation) at 200K keeping 40K; after 25 idle minutes over 100K the session rotates to
  a new one seeded with a recap.
- **Jobs:** nightly memory consolidation, heartbeat with daily task review, `~/schedule.md`.
- **Commands** (web chat): `!new`, `!stop`, `!compact`, `!model [alias]`, `!tasks [project]`,
  `!login chatgpt`.
- **Run history:** `runs.jsonl` in the state dir; `ws-runs` inside the container.

Pi coding-agent and Pi Durable use version 1.0.0. One `workspace.sqlite` database in the workspace
state directory stores accepted input receipts and queued instructions. Main and all topics
share one connection. Conversation IDs select separate documents inside that database.
Pi Durable owns the SQLite adapter, atomic commits, and document storage. The application
supplies a versioned inbox document family and a checkpoint hook for the coding-agent session.

After a workspace restart, queued instructions resume when the gateway connects. Their original
text, origin, and image attachments remain available. Consumed inputs do not replay because
their tools can have external effects. The checkpoint hook blocks tools if the consumed-input
commit fails. Stop and new-session commands withdraw queued instructions.

The first start imports existing `recent-ids.json` receipts. Existing Pi transcripts, provider
fallback, guards, and delivery outboxes keep their current formats. Active turns and subagents
still stop on restart. Full task recovery requires the Durable harness and explicit replay rules
for each tool. The inbox uses the standalone Durable session API, so it does not require a harness migration.

### Storage ownership

Each state item has one authoritative store. New workspace runtime state belongs in
`workspace.sqlite`, through the shared `DurableState` connection and versioned Durable documents.
Domain modules define documents. They do not open another database for each feature or topic.

| Data | Current store | Consolidation direction |
|---|---|---|
| Web messages, routing, web events, and push subscriptions | Gateway SQLite database | Keep with the gateway process. |
| Workspace input receipts and queued instructions | `workspace.sqlite` | Shared Durable documents, scoped by conversation. |
| Session pointers, topic metadata, scheduler state, and proactive limits | `state.json`, `topics.json`, `scheduler.json`, `proactive.json` | Migrate to versioned documents in `workspace.sqlite`. |
| Delivery receipts, subagent results, and run records | `outbox.jsonl`, `subagent-results.jsonl`, `runs.jsonl` | Migrate runtime records to `workspace.sqlite`. Keep history files as exports. |
| Pi transcripts and Pi-owned credentials | Pi JSONL sessions and `auth.json` | Keep Pi's formats until an explicit harness or credential migration. |
| Memory, tasks, skills, and schedules | Markdown files under the workspace home | Keep editable content as files. |
| Uploads, delivery attachments, and repository files | Filesystem | Store file references in runtime records. |

The remaining JSON and JSONL migrations are separate work. A migration must import existing
data before switching its authoritative store. It must stop writes to the old store and cover
restart recovery. The input-receipt migration follows this rule and does not write `recent-ids.json`.

Conversation storage must remain accessible through read-only history commands and APIs.
`ws-runs search` searches historical sessions. `ws-runs show <id> --full` exposes full tool traces,
with credential redaction. History exports and chat APIs provide historical conversation access.
If transcripts move to SQLite, these interfaces must retain original messages and tool results,
including entries removed from the model's context by compaction. Markdown history can remain a derived export.
The agent reads history through these interfaces without direct database write access.

## MCP connections

The workspace supports remote MCP servers through the web app's Connectors screen.
The agent can list current tools and call them during a chat turn.
Scheduled jobs do not receive these tools.

1. Open **Connectors → Add a server**.
2. Enter the server's HTTPS address.
3. For token authentication, enter an API token.
4. For OAuth authentication, leave the token blank and follow the sign-in steps.

For Fastmail, use `https://api.fastmail.com/mcp`.
Create an API token with **Type: MCP** and only **Read data** selected.
Fastmail enforces this permission on its server.
This permission covers email, contacts, and calendars.
Fastmail's MCP server does not support attachments.
See [Fastmail's MCP instructions](https://www.fastmail.help/hc/en-us/articles/15869557281295-Connecting-AI-tools-via-Fastmail-s-MCP-server).

The workspace stores credentials in `connectors.json` under its protected Pi agent directory, with file mode `0600`.
The browser receives no saved credentials.
Disconnect disables agent access and retains credentials for reconnection.
Remove erases the saved connection and its credentials.
Remove does not revoke the token at the provider.

Connecting a server authorizes the agent to use its tools, including new or changed definitions.
Tool snapshots show changes for tracking. They do not block calls or require per-call approval.
The annotation comes from the MCP server. Use a read-only token to enforce read-only access.
Connections support Streamable HTTP, bearer tokens, and OAuth with dynamic client registration.
Local servers, stdio, legacy SSE, and OAuth clients that need manual registration are outside this UI's scope.

## Owner-approved GitHub pushes

The workspace can commit directly on the default branch when the owner requests that workflow.
The `github_push` tool asks the owner to approve the repository, destination branch, and exact commit.
It pushes only that commit and does not force-push.
The pre-push hook permits only the approved URL, branch, and commit for that call.
Ordinary shell pushes to the default branch remain blocked.
Autonomous work uses a task branch and PR.
GitHub branch protection and GitHub App permissions still apply.

The shipped home `AGENTS.md` describes this policy.
Unedited home instructions upgrade automatically after deployment.
If the owner edited that file, the workspace preserves it. Update its GitHub instructions manually.

## One-time browser location

In the owner's main conversation, `request_current_location({ reason })` can ask for a
location fix to answer a nearby question. The request appears in the web chat and Inbox using
the existing authenticated approval stream; **Share current location** is the only action that
calls the user's own browser's `navigator.geolocation.getCurrentPosition`. The server/workspace
browser is not used. The user can deny or cancel. Browser permission is still required, even
if permission was previously granted; there is no watch or background tracking.

The browser requests high accuracy, no cached fix, and a 15-second acquisition timeout (with a
20-second UI fallback covering unanswered permission prompts). Requests expire after 90 seconds
if no client responds. Errors tell the agent to ask for a city/area instead. This currently supports
only the owner's `main` conversation, not subagents or scheduled jobs. The web gateway
must be enabled and served in a secure browser context (HTTPS, or localhost for development).

Replies are capped, strictly validated (coordinate ranges, finite numbers, accuracy and timestamp
freshness), owner-authenticated, same-origin, and correlated by a single-use random nonce to the
pending tool call and workspace connection. Browser-provided positions are not attested: the owner
can override their own device's location. Coordinates are returned only to the requesting tool,
not copied into the gateway's approval records, push payloads, analytics or audit logs. Pi tool/session
history necessarily stores the returned fix and the model provider receives it; chat replies may
also be retained. The UI discloses this before sharing. The tool and memory-flush instructions tell
the agent not to save exact fixes in durable memory or repeat them in replies unnecessarily; this
is not a sandbox preventing the general coding agent from writing arbitrary files.
