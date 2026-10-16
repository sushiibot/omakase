# web

Personal agent web app: a SvelteKit SPA (adapter-static, `ssr = false`) installed as a PWA. The gateway (`src/personal.ts`, `bun dev` at the repo root) serves `build/` and the `/api` endpoints.

```sh
bun install
bun dev              # app at http://localhost:5173, /api proxied to http://localhost:8790
bun run check        # svelte-check, warnings fail
bun run lint         # prettier, scripts/check-no-raw-html.ts (no {@html} or DOM string sinks), check-tokens.ts, check-boundaries.ts (import directions)
bun run test:unit    # bun test: markdown rules and server-rendered components
bun run build        # app build in build/ (no prototype)
bun run test:e2e     # builds, then Playwright against `vite preview` with /api mocked
```

CI runs browser tests in two shards. Static checks and unit tests run once in a separate job.
Each shard builds its own app and render harness. CI saves a JSON report for each shard.
To run one shard locally, use `bun run test:e2e --shard=1/2` or `--shard=2/2`.

The clickable prototype lives in its own routes tree, `src/proto-routes`, so it never reaches `build/`:

```sh
bun run dev:proto    # http://localhost:5173/proto
bun run build:proto  # single-file board at build-proto/proto.html
```

Frames set a phone width, but the shell and screens pick their layout from the browser window (`MediaQuery` and viewport `md:`/`lg:` classes), not from the frame. Open the board in a window narrower than 768px, or in devtools device mode, to see the phone layout inside phone frames; desktop frames need a window at least 1024px wide.

Brand assets are rendered from the transparent PNG masters in `brand-src/` with
`bun scripts/render-icons.ts`. This rebuilds `static/brand/`, the favicon, install
icons, and the monochrome notification badge. The maskable icon keeps the character
inside the central safe area on a cream background. Generation prompts are saved
in `brand-src/prompts.json`.

## Live voice

Voice chat is available in the owner web chat and topic conversations.
It supports Qwen, Gemini, and OpenAI adapters with tool handoff to the existing agent.
See [Live voice](docs/live-voice.md) for API credentials, costs, lifecycle, and protocol details.

## Browser preview

Main and topic chats show the local browser screen above the conversation.
The preview supports hide, show, full-screen viewing, zoom, and automatic cleanup.
See [Browser preview](docs/browser-preview.md) for lifecycle, transport, and verification.
The standalone Browser takeover screen remains a development preview.

## MCP connections

Connectors is available automatically in the owner web app.
The workspace stores connections and credentials outside the browser.
The screen supports token or OAuth authentication, tool-list review, reconnection, disconnection, and removal.
See [MCP connections](../README.md#mcp-connections) for setup, protocol limits, and tool access.

## UI and UX guidance

Read [UX guidelines](docs/ux-guidelines.md) before changing a screen or shared component.
They are the authority for interaction, density, responsive layout, motion, loading, copy, and accessibility.
The [shared component patterns](docs/ux-guidelines.md#shared-component-patterns) map each UI intent to its primitive.
Document new reusable patterns there. Keep feature documents focused on domain behavior.

Use the normal `Button` for routine actions. Its compact face preserves the full touch target.
Use `ScreenContent` for content geometry, `Section` for repeated groups, and a horizontal `Field` with stock `Switch` for toggle preferences.
Use `RadioGroup` choice cards for short exclusive preference choices, and `ToggleGroup` for short view filters.
Do not copy button sizing, page gutters, section headings, or control internals into feature classes.
Review shared changes on desktop and touch layouts, in both themes.

Adding UI:

1. Check whether shadcn-svelte nova ships it, and add it with the CLI (`bunx shadcn-svelte add <name>`, the pinned dev dependency) into `src/lib/ui` before writing anything by hand. Start each file with the source header the drift check expects: `<!-- shadcn-svelte nova: ui/<name>/<file> -->` in Svelte files, `// shadcn-svelte nova: ui/<name>/<file>` in TypeScript. A file the app owns, inside a stock dir or its own, starts with `<!-- app: <what it is> (ux-guidelines.md#<anchor>) -->` or `// app: ...` instead.
2. Add a `src/lib/ui/SYNC.json` entry for every `src/lib/ui` dir. A stock dir records `"drift": "none"` or one line saying what differs, citing the rule (`(ux-guidelines.md#<anchor>)`). An app-owned dir records `"source": "app"` and a `"reason"` citing the rule.
3. For a layout with no stock component, copy from the nearest shadcn-svelte block and name it in a header comment (`<!-- modeled on shadcn-svelte dashboard-01 ... -->`).
4. Run `bun run lint`; the UI drift checks fail it. `bun run lint:drift` lists every hit, and `UI_DRIFT_STRICT=0` reports drift as warnings while fixing a batch.

The [channel interaction rules](docs/channel-interaction-rules.md) define the workspace layout,
source evidence, gesture behavior, and acceptance checks. The live shell keeps channel navigation
beside desktop conversations. On phones, dragging chat reveals navigation or the supporting inspector.
Tasks and Activity stay directly accessible; Workspace holds Memory, History, Connectors, and previews.
Settings remains accessible from navigation. Existing conversation URLs and drafts remain valid.
The isolated motion prototype remains available at `/interaction-lab` with `bun run dev:proto`.
Run its touch, recovery, history, and timing checks with
`bunx playwright test -c interaction/playwright.config.ts`.

## Layout

Imports point down this list only:

- `src/routes/`: thin containers that bind stores, `page.state` and navigation to screens.
- `src/lib/features/<name>/`: one folder per feature (screens, stores, reducers, fixtures). `features/chat/` holds every component that renders agent text, so the raw-HTML lint's strictest rules apply there.
- `src/lib/core/`: app infrastructure with no screens: the SSE stream (`realtime/`), IndexedDB (`storage/`), PWA and push (`pwa/`), service-worker logic (`sw/`).
- `src/lib/ui/`: the design system, with no domain imports. shadcn-svelte adds components here (`components.json`).

Every screen on the prototype board is a feature's own screen, rendered from its `fixtures.ts`; the board imports features only through `index.ts` and `fixtures.ts`. Screens whose backend doesn't exist yet (skills, schedules, browser, briefing) call the routes that backend will serve (`api.ts`) and remain development previews, enabled through the device override in `localStorage` `features:override` (`all` or a comma list). All live screens are always available; `/api/me` `features` is a compatibility catalog, not a configuration switch. Their fixture APIs (`fake.ts`) never reach the app build (`scripts/bundle-guard.ts`): `bun dev` with `?fake` installs them from `src/routes/dev-fakes.ts` with every feature on, where `fixtures:<feature>` picks the state a fake serves (`empty`, `error`, `slow`, `offline`, `unsupported`), and the e2e suite serves the same APIs over `context.route` (`e2e/fixture-routes.ts`).

A screen is built from `ui/screen` (`Screen`, `ScreenContent`, `ListScreen`, `DetailScreen`, `TabbedScreen`, `ScreenState`) inside the root layout's `Shell`, with data from a feature store (`core/remote.svelte.ts` for fetched data, `core/realtime/hub.svelte.ts` for the stream). Sheets are `ui/sheet/routed-sheet.svelte`, opened through `core/nav/sheet.ts` so Android back closes them. Overflow menus are the stock `ui/dropdown-menu`, which holds a `CloseWatcher` while open so Android back closes the menu first; disclosures are the stock `ui/collapsible` with its `DisclosureTrigger` row; search fields are `ui/search`, built on the stock `ui/input-group`. Screens, their `components/` and `render/` take props and callbacks only, so the prototype board and the e2e harness can render them from fixtures.

## Shared responsive tabs

Use `ui/screen/TabbedScreen` for screens with tabs and swipe navigation.
It owns the screen shell, full-width pager, 16px content gutters, and panel scrolling.
Screens provide tab labels, lead content, panel content, and callbacks.
Do not add an enclosing screen, horizontal padding, or another vertical scroll container.
Set `measure="full"` for dense desktop content; the default `reading` measure centers a column.
Desktop tab changes are immediate. Touch taps select the label immediately while the panel moves.
Reduced motion removes panel animation. Do not add feature-level carousel timing or active-tab state.

The internal `SwipeableTabs` engine owns dragging, snapping, underline motion, and keyboard navigation.
The import boundary check prevents features from using that engine directly.
For detail screens, pass `state` and `hasContent` to preserve the pager during background loading and refresh failures.
Cached refresh failures show retry below the current content; first-load failures use the screen state.
Lists retain their per-panel cached state. Commit filter requests after the panel settles.

See [Tabs, swipes, and scroll ownership](docs/ux-guidelines.md#tabs-swipes-and-scroll-ownership)
and [Loading and background refresh](docs/ux-guidelines.md#loading-and-background-refresh)
for layout rules, loading patterns, research sources, and regression checks.

## Assistant Home

Home (`/assistant`) brings existing requests, documents, and work into a separate overview.
Needs you shows live approvals, questions, failed work, and channel requests.
Review opens beside the feed on wide desktops and as a full-screen view with a Back button on smaller screens.
Approval still uses the existing exact request and its normal confirmation controls.

Continue uses explicit visits to conversations and documents on this device.
Ready for you shows recent documents and inbox outcomes. In progress groups runs under their
linked active task. Following shows ongoing tasks; History shows finished tasks and links to Activity.
Review links retain their item across refresh. Linked pages push above review; Back returns one step at a time.
A review opened directly falls back to its parent list. Each source can fail and retry independently. Home keeps available content visible.
Existing chat, inbox, document, and task links remain valid. The launch route still opens chat.

Calendar proposals, Coming up, scoped automatic writes, and learned responsibilities require
new backend records. They are not represented by sample data or enabled by this Home release.

## Channels

Topic conversations appear as channels in the owner web app.
Each topic has a separate persisted workspace session and chat stream.
The sidebar reads `/api/channels`, including task work conversations.
All uses stable names; Recent uses explicit visits saved on this device.
Needs you counts unresolved request handles. Opening a channel does not resolve them.
Read positions persist on each device. New messages use brighter, heavier channel labels.
Opening a visible conversation marks its latest message read. Pending requests remain highlighted.
Task channel links open `/tasks/:id?view=conversation`; `/tasks/:id` retains the planning view.
See [Topic threads](docs/topic-threads.md) for routing, shared memory, lifecycle, and tests.

## Memory browser

Read-only Memory is available automatically in the owner web app. Long-term shows
`USER.md`, `MEMORY.md`, `DREAMS.md` and other markdown under the workspace's `memory/`.
Daily notes shows `memory/YYYY-MM-DD.md`; History holds work recaps and run records.
The browser reads the real workspace files and offers file-name search. It does not
expose editing or revert actions. File reads are capped at 256 KB and directory scans
are capped at 500 files, with a visible notice when content is limited.

## Offline conversations

The PWA saves text snapshots in IndexedDB on this device. It automatically downloads
metadata and the newest history page for every thread, including archived threads,
starting with the most recently active. History requests use the normal 40-item page size. Opening other threads or older history pages also saves them. Main's newest
history page is saved when the app opens, and live replies refresh the saved page.

The cache holds at most 50 MiB of UTF-8 response data. There is no expiry, thread-count
limit or per-thread storage limit. When full, it evicts the least recently used responses.
Background downloads use thread activity time as their priority, so they do not displace
recently browsed pages with older conversations. Offline reads keep frequently used pages.
The app shell, drafts and queued messages use separate storage. Photos and file
contents are not downloaded for offline use. Browser storage pressure can remove
snapshots sooner. Clearing site data removes them.

A network failure uses a saved snapshot and shows the offline notice, including
when internet works but the tailnet gateway cannot be reached. Live API errors remain
visible. A permission refusal clears snapshots, and a missing thread removes its cache.
The offline Threads list shows only locally available conversations. Reconnection
refreshes the list and any open conversation loaded from a snapshot.

## Tasks

Tasks is a live screen with manual to-dos, checklists, task conversations, and execution history.
Main and topic chats also expose tasks in a right panel.
See [Tasks](docs/tasks.md) for lifecycle, migration, routing, and verification.

## Agents

Codex and Claude Code agents on connected machines appear in the side panel's Agents tab, as cards
under the message that started them, and at `/agents/:id`. See [Agents](docs/agents.md) for placement,
the transcript, approvals, navigation, and the precedent behind them.

## Artifacts

Workspace includes an Artifacts library for saved Markdown reports and documents.
The agent uses `save_artifact` to create or update a document and returns its stable link in chat.
Chat shows that link as a document card. The reader links back to the source conversation.
The library searches titles and document content. `find_artifacts` gives the agent the same search and read access.

Documents persist in the workspace state directory, separately from chat sessions.
Updates retain the document ID and increase its version number. Only the latest content is retained.
Each document supports up to 256 KiB of text. Library scans stop after 2,000 documents and show a limit notice.
Read positions are device-local; documents are shared across the owner's devices.

Heartbeat and scheduled reviews can use MCP tools that declare `readOnlyHint: true`.
For tools without this annotation, the Decisions API assesses the name, description, and input schema.
This uses `WORKSPACE_MEMORY_REVIEW_MODEL`, independently of the chat model. Scores of at least 0.95 permit background reads; this inference is not a guarantee.
Explicitly writable tools remain blocked. Ambiguous tools and failed assessments remain unavailable.

Assessments persist for up to 30 days. A changed server identity, tool definition, model, or classification policy requires another assessment.
The workspace refreshes each tool definition and checks eligibility before each call.
Discovery labels eligible tools with their source: `server` or `decision-model`.
Classification results appear in runs named `job:connector-review`.

Heartbeat discovers connected tools before each prompt. It then instructs the agent to check relevant recent email, calendars, and other sources.
Recent proactive messages remain in its context for 24 hours to help prevent repeated alerts.
Connectors must already be connected in the owner app.

The default schedule runs every 120 minutes, from 08:00 to 22:00 in the workspace timezone, independently of chat activity.
`WORKSPACE_HEARTBEAT_EVERY` controls the interval; `off` disables heartbeat. `WORKSPACE_HEARTBEAT_ACTIVE` controls active hours.
The shared default limit is six proactive messages per day. Runs stop when that limit is reached.
A run with nothing useful to report returns `NO_REPLY` and sends no message.
