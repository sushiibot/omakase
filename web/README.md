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
Use `ScreenContent` for content geometry, `Section` for repeated groups, and `SwitchRow` for toggle preferences.
Use the shared segmented radio variant for short preference choices.
Do not copy button sizing, page gutters, section headings, or control internals into feature classes.
Review shared changes on desktop and touch layouts, in both themes.

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

A screen is built from `ui/screen` (`Screen`, `ScreenContent`, `ListScreen`, `DetailScreen`, `TabbedScreen`, `ScreenState`) inside the root layout's `Shell`, with data from a feature store (`core/remote.svelte.ts` for fetched data, `core/realtime/hub.svelte.ts` for the stream). Sheets are `ui/sheet/routed-sheet.svelte`, opened through `core/nav/sheet.ts` so Android back closes them. Screens, their `components/` and `render/` take props and callbacks only, so the prototype board and the e2e harness can render them from fixtures.

## Shared responsive tabs

Use `ui/screen/TabbedScreen` for screens with tabs and swipe navigation.
It owns the screen shell, full-width pager, 16px content gutters, and panel scrolling.
Screens provide tab labels, lead content, panel content, and callbacks.
Do not add an enclosing screen, horizontal padding, or another vertical scroll container.
Use `wide` for the wider desktop content measure.
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

## Channels

Topic conversations appear as channels in the owner web app.
Each topic has a separate persisted workspace session and chat stream.
The sidebar reads `/api/channels`, including task work conversations.
All uses stable names; Recent uses explicit visits saved on this device.
Needs you counts unresolved request handles. Opening a channel does not resolve them.
The catalog has no read receipts, so navigation does not invent unread counts.
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
