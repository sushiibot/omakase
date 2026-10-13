# UX guidelines

Rules for every screen and shared component in the personal agent web app. Aim for a quiet, compact interface with clear hierarchy and immediate feedback. Evaluate desktop, touch, and keyboard use together. Android remains the primary installed-PWA device.

Every rule has a one-line why and a check. A rule without a check is a wish, so review goes rule by rule and asks "did the check pass?"

This document is the authority for shared UI patterns. The [README](../README.md#ui-and-ux-guidance) explains architecture and commands. The [channel rules](channel-interaction-rules.md) add workspace-specific behavior. Feature documents own domain behavior, not alternative sizing systems.

The clickable prototype (`src/proto-routes/proto`) renders feature screens from fixtures. Use it to review states, not to prove production parity or accessibility. See [Prototype limits](#prototype-limits).

## Conversations, work and activity

A conversation contains messages and reply cycles. Main and topic conversations keep their identity across context refreshes.
A task represents a delegated assignment, separate agent assignment or scheduled objective. An agent performs the task.
A turn contains one reply cycle, its tool calls and any steering messages. A run records one execution attempt.
A session holds the model context and transcript. A session change does not create a new visible conversation.

- **Use one Conversations destination for chat and inbox navigation, Tasks for persistent assignments, and Activity for execution history.** Approvals, questions and sign-in requests appear first under Needs you, with their conversation named. Main chat stays first within the conversation list with a message icon and a visible label. A shared Inbox below the conversations holds work and scheduled updates, including heartbeats. Delivery to Main does not assign an inbox item to that conversation. Discuss opens a picker for Main, an existing thread or a new conversation, then adds the quoted item to a draft without sending it. Keep existing draft text. Recorded conversation IDs describe the source of action requests; do not guess topic associations from titles. Each section loads and recovers independently in one scroll container. Legacy inbox URLs preserve item links and open Conversations. Manual tasks and checklists live in Tasks. Activity opens on work runs; replies and system events remain in its Activity tab. Check: `pw` (`e2e/runs.test.ts`, `e2e/nav.test.ts`).
- **Use Activity, Results and Details for execution records.** Activity shows chronological steps. Results combines the recorded outcome, checks, outputs and approvals. Details contains the full request, delegation links and execution metadata. Check: `pw` (`e2e/runs.test.ts`).
- **Keep the brief out of the fixed heading.** Short existing titles can identify tasks. Long prompts use a compact agent/task label. Check: `pw` at 320px and 412px.
- **Keep chronological activity stable through completion.** Both the preview sheet and detail page show the oldest step first. Completion preserves the selected section and expanded steps. Check: `pw` (`e2e/runs.test.ts`, `e2e/background-agents.test.ts`).
- **Label delegation separately from execution mode.** A subagent can run in the foreground or background. Parent and child links describe delegation. Check: `review`.
- **Keep task identity explicit.** Do not group unrelated replies by title or elapsed time. Persistent objectives across replies require a stored task identifier. Check: `review`.

Existing `/runs` URLs, API fields and run identifiers remain compatible. The UI vocabulary does not change the execution log format.

Channel options first show actions: Open conversation, Rename, and Archive or Restore when available. Show the name field only after Rename is selected. Main supports a saved display name and cannot be archived. Keep Archived in its own collapsed section, outside search controls. Sidebar search opens matching archived results; the owner can still collapse them. Check: `pw` (`e2e/channel-workspace.test.ts`, `e2e/threads.test.ts`).

## Check key

| Tag      | Meaning                                                                                |
| -------- | -------------------------------------------------------------------------------------- |
| `axe`    | `@axe-core/playwright` scan, see [Accessibility](#accessibility)                       |
| `pw`     | Playwright assertion on touch and desktop layouts (320 wide for reflow)                |
| `shot`   | A screenshot in the [state matrix](#state-matrix), reviewed by eye against these rules |
| `phone`  | Manual step on the real phone, installed PWA, not a browser tab                        |
| `check`  | `bun run check` (svelte-check, compiler a11y warnings)                                 |
| `review` | Code review reads the diff for it; no tool catches it                                  |

## Input methods and mobile behavior

The primary mobile device is an Android phone running the installed PWA (Chrome WebAPK, `display: standalone`). Desktop uses the same primitives with denser controls and wider content. Input capability determines target sizing. Available space determines layout.

### Reach and touch targets

- **Paint stock sizes; extend hit areas invisibly on touch.** The shared `Button` paints shadcn-svelte nova sizes (`xs` 24px, `sm` 28px, default 32px, `lg` 36px); sidebar rows are 32px. On any coarse pointer, an invisible `::after` (`relative any-pointer-coarse:after:absolute`) extends each separate control's hit area to 48px tall and at most 8px past the face sideways, so it stays inside a stock gap: default and icon `after:-inset-2.25`, `lg` `after:-inset-1.75`, `sm` `after:-inset-x-2.25 after:-inset-y-2.75`, `xs` `after:-inset-x-2.25 after:-inset-y-3.25`. The extra 0.25 covers the 1px border, because an absolutely positioned `::after` is measured from the padding box. Input and Textarea keep the stock `h-8` and carry no `::after`: replaced elements render no pseudo-elements, and the full-width field is its own target. Layout uses the painted size, so the hit area never moves anything. Do not grow a target with local height classes. Why: WCAG 2.5.8 AA requires 24px; Apple's minimum is 28pt and its default 44pt; Android recommends 48dp and allows the visible element to be smaller than its target ([Android API defaults](https://developer.android.com/develop/ui/compose/accessibility/api-defaults), [Android accessibility help](https://support.google.com/accessibility/android/answer/7101858)); 1 CSS px = 1dp on Android Chrome. Layout-sized 48px controls bloat every screen. Check: `pw` hit probe (below). axe's `target-size` rule covers only the WCAG floor of 24px (`minSize: 24` in axe-core 4.13).
- **Hit areas may extend into gaps, never over another control's painted face.** Separate controls keep the stock `gap-2`; under it, the gap belongs to the later control, so each keeps its face plus 8px of its own target along the row (40px for default, 36px for `sm`) and 48px across it. Use the 16px decision gap where a mis-tap matters. Decision rows (approve/deny, destructive next to primary) use `gap-2 any-pointer-coarse:gap-4`, so each keeps a full 48px. Why: a covered face sends the tap to the wrong control; Android asks for 8dp separation, and a mis-tap on a decision is costly. Check: hit probe at each face edge resolves to that face's control; decision rows also probe 23px toward their neighbors.
- **Contiguous rows size their own box.** Navigation rows, menu and command rows, list `Item` rows and tabs get no `after:` hit area (`any-pointer-coarse:after:hidden` on a `Button` row), because it would cover the neighboring row. Navigation, menu and command rows are `h-8` with `any-pointer-coarse:h-11` (44px); list `Item` rows keep stock padding; line-variant tab triggers add `any-pointer-coarse:h-10`. Separate project groups with space; do not space every channel like an action button. Why: overlapping row targets steal taps; 44pt is Apple's default control size. Check: `pw` row height per input type.
- **Inline text links inside prose are exempt from the hit-area rules, but nothing important is reachable only through one.** Why: WCAG 2.5.8 exempts inline links because they are small and easy to miss. Check: `review`.
- **Keep frequent phone actions within reach.** Place composer actions and sheet decisions near the bottom. Keep list creation actions beside their list. Do not stretch short pages to force every action below a fixed coordinate. Why: thumb reach matters alongside context ([Hoober, How do users really hold mobile devices](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php)). Check: `shot`, `phone` with the keyboard open and closed.
- **The top bar holds title, back and secondary actions only. The general chat defaults to Sushii until the owner renames it, with no static subtitle; activity belongs beside the conversation.** Why: nothing there should need reaching for mid-task. Check: `review`.
- **Destructive or outward actions (Deny, Delete, Send now) are never the largest target and never sit where a mis-tap from the primary lands.** Why: Fitts's law works against you for dangerous actions. Check: `shot`.
- **Section swipes follow the visible tab order and stop at each end.** On touch screens, Runs filters, run details, History days, Memory and MCP details support left/right swipes in the content area. Vertical scrolling, text controls, selection and horizontal code/table scrolling keep their normal behavior. The left edge stays available to the drawer and the outer edges stay available to system navigation. Panels follow the finger continuously and snap on release; tapping a tab on phones animates the same pager, with its selected label and underline updating immediately. Desktop tabs switch panels instantly. During a held swipe the underline tracks the panel position, then marks the destination on release. Keep headers fixed and preserve each panel’s scroll and expanded content. Tabs remain the tap and keyboard alternatives. Check: `pw` (`e2e/tab-swipe.test.ts`).
- **No gesture-only actions. Every swipe or long-press has a visible button alternative.** Why: WCAG 2.5.7 Dragging Movements; gestures are undiscoverable. Check: `review`.
  - Per-message actions are visible icon buttons in a row under the message (Copy, and Share where the browser has `navigator.share`), never a gesture or a hijacked menu: the app does not intercept `contextmenu`, long-press or middle-click, so the browser's own menu, text selection and autoscroll work in the chat. The row is always shown under the newest reply and on touch screens; on hover-capable devices older rows are transparent until hover or `:focus-within`, keeping their height so nothing moves. Icons are 16px inside `Button size="icon-sm"` controls with the coarse-pointer hit area, each with an `aria-label` and a `title`. The row never holds anything approval-like. Check: `pw` (`e2e/message-actions.test.ts`).

The hit probe is `probeHitArea` in `e2e/hit-probe.ts`; `expectHitArea` asserts that no point fails. It scrolls the control to the center of the viewport, then calls `elementFromPoint` on the control's root node at the center, 1px inside each face edge, and 23px from the center on every side in `freeSides` (default: all four). Each point must resolve to the control or a descendant; a point outside the viewport fails as `off-viewport`. Pass only the sides without an adjacent control as `freeSides`. Decision rows, whose 16px touch gap leaves room for a full reach, also pass the sides that face a neighbor. Probe a sidebar row through its `SidebarMenuItem`, so a `SidebarMenuAction` over the row's right edge counts as a descendant. Run it in a touch context on real screens, not only on a controls fixture: `overflow-hidden` and scrolling ancestors clip `::after` hit areas, so a control flush against a clipping edge needs the parent's padding (`p-2`, `p-4`) to leave room.

`elementFromPoint` ignores Chromium's touch adjustment, which carries a real tap a few px past a hit area. `e2e/decision-gaps.test.ts` therefore checks every decision surface (approval tray, inline and agent cards, tool confirmation in both orders, task stacks, voice bar and panel, ask card, unsent messages, confirm sheets, file store rows) twice: with `elementFromPoint` 1–7px into each gap, and with real `page.touchscreen.tap` taps 1–6px into it (touch points land on whole CSS px), recording whose `click` each tap becomes. A tap on one side never reaches the far control.

```ts
// Approve sits left of Deny in a decision row with a 16px touch gap, so the right side is probed too.
await expectHitArea(page, approve, { freeSides: ['top', 'right', 'bottom', 'left'] });
```

### Viewport, keyboard and system bars

- **`app.html` uses exactly this viewport meta:**

  ```html
  <meta
  	name="viewport"
  	content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
  />
  ```

  Why: since Chrome 108 the keyboard resizes only the visual viewport by default; `resizes-content` restores resizing the layout, so a flex column keeps the composer above the keyboard with no script ([Chrome: viewport resize behavior](https://developer.chrome.com/blog/viewport-resize-behavior)). `viewport-fit=cover` opts into edge-to-edge drawing so the app, not Chrome, owns the gesture-bar area ([Chrome edge-to-edge guide](https://developer.chrome.com/docs/css-ui/edge-to-edge)). Check: `review` of `app.html`.

- **The keyboard never covers the composer or the focused field.** Why: the most common "this app is broken" moment on phones; also WCAG 2.4.11 Focus Not Obscured. Check: `phone`: open a chat, tap the composer, type three lines; the composer and its send button stay fully visible.
- **Keep the `--kb` visualViewport fallback for iOS, where `interactive-widget` has not shipped.** Why: iOS overlays the keyboard; the layout does not resize. Check: `review` (the shell and sheets read `--kb`, defined in `app.css`).
- **The app root uses `100dvh` or `inset: 0`, never `100vh`.** Why: `100vh` ignores the dynamic browser UI and the keyboard. Check: `rg -n -g '!src/proto-routes/**' '100vh|h-screen' src` returns nothing (`h-screen`, `min-h-screen` and `max-h-screen` compile to `100vh`).
- **Anything pinned to the top or bottom pads with `env(safe-area-inset-*)`: the header and the drawer add `--safe-top`, the composer and the drawer add `--safe-bottom`.** Why: edge-to-edge content otherwise sits under the status bar and the gesture bar. Check: `phone` with gesture navigation on; nothing tappable overlaps the gesture pill.
- **Inputs use the stock Input and Textarea text sizes: 16px below `md`, 14px above (`text-base md:text-sm`).** This is a legibility size kept from stock, not a target size. Why: iOS zooms the page on focus below 16px; the same size reads well on Android. Check: `pw` computed style on `textarea, input` at 412px.
- **`theme-color` matches `--background` in both themes, via two `<meta name="theme-color" media="(prefers-color-scheme: ...)">` tags or a script that follows the theme toggle.** Why: a white status bar over a dark app looks broken. Check: `phone` in light and dark.
- **`overscroll-behavior: none` on the document, `contain` on scroll regions.** Why: stops pull-to-refresh from reloading the app mid-chat and stops scroll chaining into the page. Check: `phone`: pull down at the top of a chat; the app does not reload.

### Back gesture and navigation

A standalone PWA has no browser toolbar. App back controls and the Android back gesture must agree.

- **Back closes the topmost overlay first (sheet, dialog, menu), and only then leaves the screen.** Why: Android sends a close request that native `<dialog>` and `popover` handle for free; a `div role="dialog"` ignores it and back navigates away instead ([MDN CloseWatcher](https://developer.mozilla.org/en-US/docs/Web/API/CloseWatcher)). This applies to the shadcn-svelte Dialog and Sheet too: bits-ui renders them as `div`s, so each needs the history-entry wrapper or a verified close on the phone. Build overlays on `<dialog>`/`popover`, or have them push a history entry and close on `popstate`. Check: `phone`: open every sheet and press back; the sheet closes and the screen stays.
- **Drawer navigation reveals the destination, not the previous page.** Keep the drawer open while a selected route loads. Close it after the destination renders. Choosing the current destination can close it immediately. Check: `pw`: delay the destination's route chunk; the drawer stays open and closes over the new header.
- **Sheet dismissal finishes before a following route change.** Phone sheets slide out fully and fade; desktop dialogs fade with a small scale change. Content and scrim use the same duration. Reduced motion disables both animations. Check: `pw` (`e2e/sheet-motion.test.ts`).
- **Every pushed screen (chat, run detail, memory diff) is a real URL navigated with `goto`, never `replaceState` or in-component state.** Why: with one history entry, back exits the app. Check: `phone`: Home → chat → run detail, then back twice lands on Home.
- **Back closes the drawer first; back from a drawer destination returns to the chat; back from the chat exits.** Why: the Android convention for drawer apps, and the chat is where the app opens. Picking a destination from the drawer replaces the entry unless it is left from the chat. Check: `pw` (`e2e/nav.test.ts`), `phone`.
- **A dirty composer or edit survives back and return.** Why: a mis-swipe must not cost a typed message. Keep the draft per chat in memory, and in `sessionStorage` for reloads. Check: `phone`: type, swipe back, reopen the chat; the text is there.
- **No `target="_blank"` for in-app routes.** Why: it opens a Custom Tab and breaks back. Check: `review`.
- **The app opens on chat. Channels, Tasks, Activity, Workspace, and Settings use persistent desktop navigation and mobile navigation. Nested detail and creation screens show a back chevron to their parent.** Why: the chat keeps the full height (no tab bar under the composer), and one navigation system per screen. The drawer is a native modal `<dialog>`, so Android back and Escape close it. The menu button carries a dot when the inbox has something waiting or unread. Check: `shot`, `pw` (`e2e/nav.test.ts`).

## Interaction and information hierarchy

These rules guide new screens and changes to existing screens. They describe the required behavior, not completed implementation.

- **Start with the user's next decision.** Why: a screen becomes easier to scan when its content supports one task. Check: `review`: name the task and the main action before choosing the layout.
- **Reuse familiar controls and shared components.** Why: repeated patterns reduce relearning and prevent layout drift. Check: `review`: inspect existing `ui/` components and feature patterns before creating a new variant.
- **Group secondary actions in one predictable menu.** Reuse [ActionMenu](../src/lib/ui/menu/action-menu.svelte) for compact header commands. Why: several equally prominent actions compete with the main task. Check: `shot`, `phone`: related thread actions share one overflow menu, and the main action remains visible.
- **Use links for navigation and buttons for actions.** Why: browser behavior and accessible semantics depend on this distinction. Check: `review`, `check`: navigation rows use anchors; actions use buttons; interactive controls never nest inside anchors.
- **Keep decision-changing information visible.** Why: users cannot act on a consequence hidden behind a disclosure. Check: `review`: permissions, action scope, and failure status remain visible before the relevant action.
- **Disclose reference detail where it helps.** Why: long explanations crowd the task. Check: `shot`, `phone`: inline details use a disclosure; mid-task reading uses a sheet that returns to the same position.
- **Name disclosures by their contents.** Why: labels such as “More info” do not explain why someone would open them. Check: `review`: the label names the topic, and expanded content adds detail instead of repeating visible copy.
- **Reuse explanatory content across presentations.** Why: separate copies of the same help text drift. Check: `review`: a disclosure and sheet that explain the same concept render shared content.

## Lists, filters, and data views

Apply these rules to Runs, History, Memory, connections, and future data screens.

- **Keep row anatomy consistent.** Why: the same object must remain recognizable across lists and lifecycle states. Check: `shot`: title, summary, status, and metadata keep their relative positions across views.
- **Put consequential decisions in their full context.** Why: a summary row can omit the information needed for a safe decision. Check: `review`: approval opens the exact action and evidence before the decision controls.
- **Keep status transitions traceable.** Why: an item that disappears after an action can look lost. Check: `pw`: an updated item remains reachable through its detail URL or an explicit completed/history view.
- **Show the active scope.** Why: an unexplained filter can look like missing data. Check: `shot`, `pw`: the selected tab or filter is visible, and users can clear filters without reloading.
- **Separate empty results from empty collections.** Why: “No runs yet” gives the wrong explanation when a filter excludes existing runs. Check: `pw`: no-match states offer clear/reset; empty collections explain what will appear and the next useful action.
- **Choose a useful default order.** Why: insertion order rarely matches the next decision. Check: `review`: queues prioritize attention; history prioritizes recency; the current sort is understandable.
- **Adapt dense data to phones.** Why: a wide desktop table can hide the fields needed for the task. Check: `shot` at 320px and 412px: rows become stacked summaries where appropriate, with secondary fields in detail.
- **Align comparable numbers.** Why: stable columns make differences easier to scan. Check: `shot`: numeric columns align right and use tabular numerals; text aligns left.
- **Add table machinery only for a concrete need.** Why: sorting a small loaded list does not require a new abstraction or dependency. Check: `review`: pagination, virtualization, or column management justifies extra table infrastructure.
- **Make bulk scope explicit when bulk actions exist.** Why: selection can extend beyond the visible page. Check: `pw`, `shot`: visible checkboxes and an affected-item count distinguish current-page selection from all matching items.

## Forms, edits, and recovery

- **Use persistent labels and field-level errors.** Why: placeholders disappear during entry, and a generic error leaves users guessing. Check: `axe`, `pw`: labels remain visible; errors associate with the relevant fields; values survive failed saves.
- **Accept harmless input variation.** Why: whitespace or common formatting must not create unnecessary work. Check: `pw`: supported input formats normalize consistently, without changing a meaningful URL, token, or identifier.
- **Use the control that matches the choice.** Why: actions, settings, and fixed options have different expectations. Check: `review`: menus contain actions; selects contain mutually exclusive options; switches represent immediate on/off settings.
- **Confirm the actual save result.** Why: an optimistic update is not proof that the server accepted it. Check: `pw`: saving, saved, and failed states remain distinct; failed edits retain values and offer retry.
- **Protect substantial unsaved work.** Why: accidental back or dismissal must not silently discard an edit. Check: `pw`, `phone`: dirty forms preserve their draft or explain discard; clean forms close without a warning.
- **Scope restored drafts to the record.** Why: an edit for one item must never appear in another. Check: `pw`: draft keys include the route and record identity; successful saves clear the draft.
- **Make restored form drafts explicit.** Why: stale values can overwrite a fresh edit unnoticed. Check: `shot`, `pw`: restoration has a visible discard action and an expiry appropriate to the task. Chat drafts follow the chat-specific rule above.
- **Choose draft storage deliberately.** Why: persistent storage can expose secrets or sensitive content on a shared device. Check: `review`: persistence, retained fields, expiry, and clearing behavior are documented; credentials never enter form draft storage.
- **Match confirmation to the consequence.** Why: routine confirmation trains reflexive acceptance. Check: `review`: reversible local edits favor recovery or undo; consequential actions explain the exact effect before commitment.
- **Keep delayed external effects honest.** Why: a queued action is not complete, and undo must remain available while cancellation is possible. Check: `pw`: any grace period appears on the item, survives navigation, and states when undo ends.

## Chat and agent

### Sending

- **A sent message renders in the list within one frame of tapping Send, before any network call.** Why: waiting for the server makes the app feel broken on mobile networks (optimistic UI; Doherty threshold). Check: `pw`: tap Send with the network throttled to 3G; the bubble is visible within 100ms.
- **Every user message shows its delivery state in text or icon plus an accessible label: Sending → Sent → (optional) Seen by agent; or Failed with Retry.** Why: "did it go?" is the question a chat-app DM never answers well. Check: `shot` of each state; `axe` for the labels.
- **Failed sends stay in place with Retry and Delete, keep their text, and never vanish.** Why: silent loss is the worst chat bug. Check: `pw`: fail the POST; the bubble shows Failed and Retry resends the same client id.
- **Messages carry a client-generated id so a retry or a reconnect never duplicates them.** Why: retries after a timeout are the usual source of doubles. Check: `review` of the send path.
- **Sends while offline queue locally and show "Queued, sends when you're back online".** Why: the phone drops off the tailnet often. Check: `pw` with `context.setOffline(true)`.
- **The composer grows up to about 6 lines, then scrolls inside itself. Enter inserts a newline on touch devices; the Send button sends. Desktop Enter sends, and Shift+Enter inserts a newline. Enter during input-method composition never sends.** Use primary pointer and hover capabilities, not screen width, to choose the shortcut. Why: a mobile keyboard's Enter is not a send intent. Check: `phone`, `pw` (`e2e/composer-keyboard.test.ts`).

### Streaming and scroll

- **The chat opens at the newest message, with no visible scroll animation.** Why: the newest message is why you opened it. Check: `pw`: after load, the distance from the bottom (`scrollHeight - clientHeight - |scrollTop|`, which holds for both normal and `flex-col-reverse` containers) is ≤ 1px.
- **Stick to the bottom only when the reader is already within 48px of it.** Why: auto-scrolling while someone reads older messages yanks the text away. Check: `pw` (below).
- **When the reader is scrolled up and new content arrives, show a "New messages" pill above the composer; tapping it scrolls to the newest message.** Why: the reader learns something arrived without losing their place. Check: `pw` (below), `shot`.
- **Streaming never shifts the text the reader is looking at.** Why: layout shift while reading is the main jank complaint in chat UIs. Use `overflow-anchor` or the column-reverse container, and reserve height for a message before its content lands. Check: `pw` (below).
- **Batch streamed tokens to at most one DOM update per animation frame.** Why: per-token updates drop frames on mid-range phones. Check: `review`; `phone` with a long streaming reply stays smooth.
- **Do not put streaming text in an `aria-live` region token by token. Announce "Agent replied" once the message completes.** Why: per-token announcements make a screen reader unusable. Check: `review`.

```ts
// Scroll-jank test: reader scrolled up, new content arrives, nothing moves.
// Scroll by delta: in a flex-col-reverse container scrollTop is 0 at the bottom and negative above it.
await list.hover();
await page.mouse.wheel(0, -600);
const fromBottom = () =>
	list.evaluate((el) => el.scrollHeight - el.clientHeight - Math.abs(el.scrollTop));
expect(await fromBottom()).toBeGreaterThan(48); // precondition: the reader really left the bottom
const topVisible = () =>
	list.evaluate((el) => {
		const box = el.getBoundingClientRect();
		const msg = [...el.querySelectorAll('[data-message-id]')].find(
			(m) => m.getBoundingClientRect().bottom > box.top
		)!;
		return { id: msg.getAttribute('data-message-id'), top: msg.getBoundingClientRect().top };
	});
const before = await topVisible();
await pushStreamChunks(page, 20); // fixture helper: append a message and stream into it
const anchor = list.locator(`[data-message-id="${before.id}"]`);
const after = await anchor.evaluate((e) => e.getBoundingClientRect().top);
expect(Math.abs(after - before.top)).toBeLessThanOrEqual(1);
await expect(page.getByRole('button', { name: /new messages/i })).toBeVisible();
```

### Live voice

- **Keep the call button in the top-right header.** After connection, close setup and show a compact call bar below the header. Keep mute, captions, and End call visible. Implementation: `VoiceControl` and `VoiceCallBar`. Check: `pw`, `shot` at 320px and desktop widths.
- **Keep chat, tool activity, and approvals visible during calls.** Show microphone and playback state separately from background agent work. Opening settings must keep the call running. Check: `pw` with a working agent and an open call.

- **Show live browser previews below the call bar, above chat.** Keep the inline image compact. Hide stops frame delivery and leaves a Show control; it keeps browser work running. Expand opens a full-screen viewer with fit and zoom. Back closes that viewer. Finished previews collapse after five seconds; an expanded viewer retains the final frame until dismissed. Check: `pw`, `shot` at 320px and desktop widths (`e2e/browser-preview.test.ts`).
- **Show provider captions in the existing chat message layout as text arrives. Use muted italic text until finalized, and keep an icon with “Voice” below spoken messages after finalization.** Replace revised snapshots and final corrections without duplicate words. Provider timing may delay text until a pause. Hide the empty-thread greeting once voice text arrives. Keep token updates out of live announcements. Implementation: shared `MessageText`, `VoiceCaptions`, and the provider adapters. Check: protocol tests and `pw` with revisions and delayed final text.

### Tool activity

- **The agent shows a compact typing indicator within 300ms of receiving a message, until text or activity arrives.** Why: silence reads as a missed message, while an oversized status block wastes space. Check: `pw` with delayed replies.
- **Tool calls appear individually in chronological order between assistant text.** Each compact row names the action in plain words and shows its status; do not merge every call into one block above the reply. Why: the user can follow the work where it happened. Coding-agent transcripts, where a turn runs dozens of commands, keep the rows individual inside one disclosure per turn whose summary names counts and failures ([Agents](agents.md#work-groups)). Check: `pw`, `shot` with interleaved text and 5+ calls.
- **Each tool row expands to exact input and output on demand.** Keep raw JSON and long results out of the default transcript. A failed action remains visibly failed while collapsed. Check: `phone`, `shot`.
- **Completed tools remain compact in history and preserve the same ordering after reload.** Why: streaming and restored history should describe the same conversation. Check: `pw` after reload.
- **Delegated work stays visible in the originating conversation.** Show a compact card under the message that started the work, with agent, folder, status, and latest activity; it updates in place and opens the detail. Live agents are listed in the side panel's Agents tab, not in a strip above the composer. Stop and steering live in the agent's detail. Inbox is a secondary notification surface. Why: work should be findable where the user started it, without crowding the composer. Check: `pw` after the parent reply and reload (`e2e/agents.test.ts`).

### Approval cards

- **Pending approvals attach directly to their tool call, using the same component in prototypes and live chat.** Show a readable action title and structured details appropriate to the action, with exact raw arguments under “Exact input.” Long bodies expand on demand. Why: the user needs clarity without a large debug dump or duplicated card. Check: `review`, `shot` on mobile and desktop.
- **Approve and Deny name the decision clearly.** Editing appears only when the action supports editing; do not imply it exists for every tool. Why: controls must match the action available. Check: `review` against API behavior.
- **While submitting, disable decision controls and show “Submitting…” until server confirmation.** Do not dismiss the request optimistically. On failure, retain the request and show the error. Check: `pw` with delayed and rejected decisions.
- **Once answered, replace the approval prompt with a quiet decision status in the tool's expandable details.** Retain the decision for inspection, but remove the attention card and controls. Denied, expired, and cancelled requests also cease to appear actionable. Why: an answered request should not look pending. Check: `pw` after answering and reload.
- **Approval status is separate from execution status.** Approved does not imply Running, Completed, or successful execution. Check: `pw` for approval followed by execution failure.
- **Durable allow rules are separate, off-by-default controls that explain exactly which future actions they cover.** Tainted runs explain why approval was requested despite an allow rule. Check: `review`.
- **Every pending approval appears in Inbox and in the tab badge, with a link to its originating conversation.** Badges count pending request ids, never agents or failures. Why: the user can find a buried request without making Inbox the only place it is visible, and one decision counts once. Check: `pw`.

### Outcomes: finished is not succeeded

- **A run ends as `verified` or `unverified`, never a plain green "Done".** Why: vendors' own docs say a completed run doesn't confirm the result ([Claude routines](https://code.claude.com/docs/en/routines), [Dots](https://learn.chatgpt.com/docs/dots)). Use the `status.ts` keys. Check: `review`, `shot`.
- **`verified` lists its evidence: message-id, readback, HTTP status, file, screenshot (`Evidence.kind`).** Why: evidence is what makes a result trustworthy. Check: `shot` of run detail.
- **`unverified` says what was not checked, in one line.** Why: it tells the user what to check themselves. Check: `shot`.
- **Quiet scheduled runs say why they were quiet: `quiet`, `suppressed`, `skipped`, `outside-hours`, or `failed`.** Why: "nothing happened" and "it broke" look the same without it. Check: `shot` of Schedules.
- **Failures file under "Waiting on you", not under "Done".** Why: a failure needs a decision. Check: `pw` on Home grouping.

### Long content on narrow screens

- **No horizontal page scroll at 320px, whatever the content.** Why: WCAG 1.4.10 Reflow. Check: `pw` reflow assertion at 320 and 412.
- **Code blocks scroll horizontally inside their own box, keep a Copy button (`icon-sm` with the coarse-pointer hit area) in view, and never wrap code silently.** Why: wrapped code is wrong code; page-level overflow breaks the layout. Check: `shot` with a 200-column line.
- **Long URLs, paths, message-ids and hashes use `break-all` or `overflow-wrap: anywhere`.** Why: one long token otherwise widens the page. Check: `pw` reflow with the long-content fixture.
- **Tables in replies scroll inside a wrapper, with the first column sticky if it's wider than the screen.** Why: tables can't reflow. Check: `shot`.
- **Messages over about 40 lines collapse with "Show all (N lines)".** Why: one giant reply shouldn't push the conversation off-screen. Check: `shot`.
- **Diffs use `--add`/`--del` backgrounds plus a `+`/`−` gutter, not color alone.** Why: WCAG 1.4.1 Use of Color. Check: `shot` in dark.

### Never-silent states

Blocking waits and required actions need visible feedback. Cached background refreshes can remain quiet. A spinner alone does not explain a wait.

| State            | What the user sees                                                           | Check         |
| ---------------- | ---------------------------------------------------------------------------- | ------------- |
| Offline          | Top banner "Offline. Messages send when you reconnect."                      | `pw` offline  |
| Reconnecting     | "Reconnecting…" with elapsed time after 5s; resumes on its own               | `pw`, `phone` |
| Reconnected      | Banner clears; missed messages load in place, no duplicate bubbles           | `pw`          |
| Queued send      | Bubble marked "Queued"                                                       | `pw`          |
| Failed send      | Bubble marked "Failed" with Retry                                            | `pw`          |
| Agent working    | "Working" row with the current step                                          | `shot`        |
| Waiting on you   | Card in chat, item in Inbox, badge on the drawer button                      | `shot`        |
| Agent error      | Inline error naming the layer that failed (model, tool, connection)          | `shot`        |
| Loading a screen | Delayed layout-matched placeholders on first load; cached content on refresh | `shot`        |
| Empty            | What will appear here, plus one next action                                  | `shot`        |
| Update available | "Update ready · Reload"; never reloads on its own mid-typing                 | `phone`       |

- **Reconnection is automatic with backoff, and never asks the user to reload.** Why: the tailnet drops whenever the phone changes network. Check: `phone`: toggle airplane mode for 20s mid-stream; the reply finishes after reconnect.
- **Error text names what failed and what to do ("Model provider timed out. Retry."), never a status code alone.** Why: Hermes's layer-named error cards are the good example. Check: `review`.

## Perceived-performance budgets

Measured on the real phone (mid-range Android), installed PWA, on the tailnet. Budgets are for the 75th percentile of dogfood sessions, matching how web.dev sets its thresholds.

| Moment                                            | Budget        | Basis                                                                                                          | Check                    |
| ------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Cold open to app shell painted                    | ≤ 1.0s        | Shell is precached by the service worker                                                                       | `phone`, Performance tab |
| Cold open to newest messages visible              | ≤ 2.5s        | LCP "good" is ≤ 2.5s ([web.dev LCP](https://web.dev/articles/lcp))                                             | `phone`                  |
| Tap Send to own bubble visible                    | ≤ 100ms       | Optimistic render, no network                                                                                  | `pw`                     |
| Message received to "Working" visible             | ≤ 300ms       | Past this, silence reads as failure                                                                            | `pw`                     |
| First token received to first token painted       | ≤ 1 frame     | The UI adds no buffering of its own                                                                            | `review`                 |
| No token 2s after "Working"                       | Show the step | "Thinking…" or the current tool, never a bare spinner                                                          | `shot`                   |
| Any interaction (tap, toggle, tab switch)         | INP ≤ 200ms   | INP "good" is ≤ 200ms ([web.dev INP](https://web.dev/articles/inp))                                            | `phone`, `pw` trace      |
| Micro-interaction animation (press, toggle, pill) | 100–200ms     | M3 short2–short4 ([M3 duration tokens](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs)) | `review`                 |
| Sheet, dialog, screen transition                  | 250–300ms     | M3 medium1–medium2                                                                                             | `review`                 |
| Any animation                                     | never > 400ms | Longer animations block a user who already knows where they're going                                           | `review`                 |

## Notifications

The push payload is `{ title, body, url, tag? }`; the service worker shows it, and a click focuses or opens `url`. Everything below fits that shape.

- **Push only for three things: the agent needs you (approval, question), a run failed, or a run finished that you asked to hear about.** Why: every notification for routine success trains the user to ignore all of them. Check: `review` of every server call site that sends a push.
- **`title` states the situation, `body` the specific item: "Approval needed" / "Send reply to Sam: Re: invoice #1042".** Why: the notification should be actionable from the shade without opening the app. Check: `review`.
- **`url` deep-links to the exact item (the approval card, the failed run), never to `/`.** Why: landing on Home and hunting is the most common push complaint. Check: `phone`: tap each notification type, landing on the item with it scrolled into view and focused.
- **`tag` is the item id, so updates to one item replace its notification instead of stacking.** Why: five notifications for one run is noise. Check: `phone`.
- **Opening the item in the app clears its notification (`getNotifications({ tag })` then `close()`).** Why: a handled item shouldn't wait in the shade. Check: `phone`.
- **Every push rings normally; none is sent with `silent: true`.** Why: the push rules above already keep routine success out of the shade, so what does arrive deserves a sound. Check: `review` of the push call site.
- **The permission prompt appears only after tapping an "Enable notifications" button that explains what will be sent.** Why: a cold permission prompt gets denied, and iOS requires a user gesture. Check: `phone`.
- **No badge counts for anything except items waiting on you.** Why: unread-message badges become noise. Check: `review`.

## Visual system

### Tokens

- **Colors come only from the tokens in `src/app.css`, never literal colors (`#hex`, `oklch(...)` in a class, `bg-[#...]`) or Tailwind palette colors (`text-red-500`).** Why: literal colors break dark mode and drift. Check: `rg -n -g '*.svelte' -e '-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\b' -e '\[#[0-9a-fA-F]{3,8}\]' -e '#[0-9a-fA-F]{6}\b' -g '!src/proto-routes/**' src` is empty (the proto's fake phone chrome is exempt); `src/app.css` is the only file that defines color values. `bun run lint` runs this check as `scripts/check-tokens.ts`.
- **Status meaning uses the status tokens, each paired with an icon and a label: `waiting`, `running`, `review`, `failed`, `taint`, plus `neutral`, via `StatePill`/`toneClass` in `src/lib/ui/status/status.ts`.** Why: one vocabulary across Home, chat and runs; color is never the only signal (WCAG 1.4.1). Check: `review`.
- **`--brand` (indigo) is for focus rings, selection and small accents; primary buttons stay `--primary`.** Why: one accent keeps status colors readable. Check: `shot`.
- **Every token pair used for text meets 4.5:1, and UI boundaries 3:1, in both themes.** Why: WCAG 1.4.3 / 1.4.11. Check: `axe` `color-contrast` in light and dark runs; for `*-soft` backgrounds, which axe can miss behind translucent layers, check by hand when a token changes.

### Type scale

| Role             | Class                                       | Use                                                 |
| ---------------- | ------------------------------------------- | --------------------------------------------------- |
| Page title       | `text-base font-medium`                     | `Page.Header` `h1` (dashboard-01)                   |
| Section heading  | `text-sm font-medium`                       | `Section`                                           |
| Group/list label | `text-xs font-medium text-muted-foreground` | `Section tone="list"`, `SidebarGroupLabel`          |
| Description      | `text-sm text-muted-foreground`             | `Page.Intro`, `FieldDescription`, `CardDescription` |
| Sheet title      | `text-base font-medium`                     | `Sheet.Title` (stock)                               |
| UI text          | `text-sm`                                   | Rows, buttons, form labels                          |
| Meta             | `text-xs`                                   | Timestamps, captions, badges                        |
| Message body     | `text-body` (15px / 1.5)                    | Chat transcript only                                |
| Code             | `text-code`                                 | Code blocks, ids, tool names                        |

- **Nothing below 12px (`text-xs`); body text never below 14px.** `text-lg` and larger are reserved for markdown headings and empty-state lines. Why: legibility at arm's length, and one heading scale across screens. Check: `review`.
- **Text sizes use Tailwind's stock sizes (`text-xs`, `text-sm`, `text-base`) or the transcript tokens in `src/app.css` (`text-body`, `text-code`).** Stock class names let copied shadcn-svelte code work unchanged. `scripts/check-tokens.ts` rejects `text-[Npx]`.
- **Text sizes use `rem`, never `px`.** Why: with `<meta name="text-scale" content="scale">` (already in `app.html`) the root font size follows the OS text-size setting in browsers that support it, but only `rem`/`em` text scales ([MDN text-scale](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/text-scale)); WCAG 1.4.4 Resize Text. Check: `phone` at the largest system font size; nothing clips or overlaps.
- **Sentence case everywhere; no Title Case, no ALL CAPS labels.** Why: easier to read, and matches the rest of the app. Check: `review`.

### Spacing and density

- **Use the block rhythm on a 4px grid.** `Page.Body` owns `p-4 md:p-6` and `gap-4 md:gap-6`. Content is centered at `max-w-3xl` (`reading`, the default); dense lists opt into `full`. Sections use `gap-2` between heading and content. Chat keeps 16px between messages. Why: this matches shadcn-svelte sidebar-10/15 and dashboard-01, so copied block code needs no translation. Check: `shot` at 412 and 1280.
- **Headers share one height.** The navigation, chat and inspector headers use `h-(--header-height)` (56px, defined in `src/app.css`). Why: header bottoms align into one line across panes. Check: `shot` at 1280 with the inspector open.
- **Use one content column on phones.** Desktop docks panes at the [Breakpoints](#breakpoints) widths and uses aligned metadata columns where useful. Why: each layout supports its available space. Check: `shot` at 412 and 1280.
- **Keep layout dimensions in shared components.** Why: per-screen widths and gutters drift when each caller repeats them. Check: `review`, `shot`: screen wrappers own sizing and scroll policy; content does not add competing outer widths or gutters.
- **Align visible content edges.** Why: a header or back control with unexplained inset looks detached from its content. Check: `shot` at 320px, 412px, and desktop: compare text and icon edges, not only control bounding boxes.
- **Line length of chat text at most ~70 characters on desktop.** Why: long lines are hard to track. Check: `shot` at 1280.

### Breakpoints

| Decision              | Rule                                       | Source                       |
| --------------------- | ------------------------------------------ | ---------------------------- |
| Persistent navigation | Docked left navigation at 768px and wider  | `md`, `MOBILE_BREAKPOINT`    |
| Persistent inspector  | Docked right inspector at 1024px and wider | `lg`, `INSPECTOR_BREAKPOINT` |
| Touch sizing          | Hit areas and navigation row heights       | `any-pointer-coarse:`        |

- **Never use width for touch sizing (hit areas, row heights); never use pointer for layout.** Input text size follows stock (`text-base md:text-sm`). Width breakpoints decide which panes are docked; `any-pointer-coarse:` decides hit areas and row heights. Any coarse pointer keeps touch sizing, including on mixed-input devices. Why: a narrow desktop window still has a mouse, and a wide tablet still has touch. Check: `review`; `pw` with a narrow fine-pointer context and a wide touch context.
- **Scripts read breakpoints from `src/lib/ui/breakpoints.ts`.** CSS uses Tailwind's `md` and `lg`, pinned in px in the `src/app.css` `@theme` so they match the constants under OS text scaling. Why: rem media queries move with the root font size while a px `matchMedia` does not, and the two must agree. Check: `review`.

### Dark and light

- **Both themes are first-class; the default follows `prefers-color-scheme` and a manual toggle persists.** Why: the phone is used at night. Check: every `shot` is taken in both.
- **No pure black background (`--background` dark is `oklch(0.145 0 0)`).** Why: pure black smears on OLED when scrolling. Check: `review`.

### Motion

- **All transitions respect `prefers-reduced-motion: reduce`: they become instant or opacity-only.** Why: motion can cause nausea (WCAG 2.3.3, AAA, adopted here because it costs one media query). Check: `pw` with `page.emulateMedia({ reducedMotion: 'reduce' })`; no transform animations run.
- **Motion explains a change (a sheet rising, a message arriving), never decorates.** Why: decorative motion delays the user. Check: `review`.
- **The spinner icon (`LoaderCircle`) always comes with text.** Why: a spinner says nothing about what it waits on. Check: `review`.

### Shared component patterns

Reference first: check the shadcn-svelte nova component in `$lib/ui` (added with the CLI) and the named block on [shadcn-svelte blocks](https://shadcn-svelte.com/blocks) (sidebar-07, sidebar-10, sidebar-15, sidebar-16, dashboard-01) before writing layout. shadcn-svelte nova supplies the pixel specification. Linear informs restraint, alignment, and density. Use the existing primitive before adding feature-specific styles.

#### Linear patterns we follow

Each line names what the app takes from Linear and the rule it maps to.

- **Restraint and density:** quiet rows, status colour only on the icon and label, no decorative backgrounds. Rule: "Use quiet text and icons for secondary states".
- **List rows:** title, one status line, one metadata line, right-aligned age in tabular numerals. Rule: "Keep row anatomy consistent".
- **Status icon with a text label:** every status keeps its word next to the icon. Rule: status tokens via `StatePill`, WCAG 1.4.1.
- **Side-peek detail:** a selected item opens beside the list in the docked inspector; phones open a full page. Rule: channel P1 agent exception, Back and navigation rules.
- **Needs-attention grouping and inbox:** items waiting on the owner come first; Needs you and Inbox stay separate. Rule: "Choose a useful default order", Conversations destination.
- **Collapsing similar events:** a coding agent's turn collapses into one work group with counts. Rule: tool-call rule, agent exception.
- **Agent session card and activity:** the agent's card lives in the conversation that started it and shows its latest step. Rule: "Delegated work stays visible in the originating conversation".
- **Delegate versus owner:** the agent works, the owner decides; approvals are answered only by the owner, labelled with who wrote each prompt. Rule: approval cards.

Where the app departs:

- **No icon-only status.** Linear's status circles carry no word; here the label always shows. Rule: WCAG 1.4.1.
- **No gesture- or key-only actions.** Space-to-peek and swipe-to-delete need a visible control here. Rule: "No gesture-only actions".
- **No single-key decisions on approvals.** Focus lands on the request heading, never on Approve. Rule: approval cards.

| Intent                 | Shared implementation                                                                        | Caller responsibility                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal action          | [Button](../src/lib/ui/button/button.svelte)                                                 | Choose the action, variant, accessible name, and disabled/pending state. Use intrinsic width.                                                                                                                                                                                                                                                                                                                                    |
| Prominent decision     | `Button size="lg"`                                                                           | Reserve the larger face for sheet and approval decisions. Do not use it for routine Add, Edit, Retry, or pagination.                                                                                                                                                                                                                                                                                                             |
| Page anatomy           | `Page.Header`, `Page.Intro`, `Page.Body`; inside a Screen, `ScreenHeader` and `ScreenFooter` | Header at `--header-height`: optional `leading` (drawer button or back link, from `ScreenHeader`), the title (`level` 1, or 2 for a pane beside the page) with an optional `subtitle`, a `breadcrumb` that replaces the title from `md`, and `ms-auto` actions. Intro: an optional `h2` title, description and actions. Body: choose `reading` (default) or `full` on the Screen; `ScreenContent` and `ScreenFooter` inherit it. |
| Repeated collections   | [ListScreen](../src/lib/ui/screen/list-screen.svelte)                                        | Supply sections, row content, search, state, and actions. Let the wrapper own outer spacing.                                                                                                                                                                                                                                                                                                                                     |
| Remote state           | [ScreenState](../src/lib/ui/screen/screen-state.svelte)                                      | Distinguish initial loading, empty collections, no matches, and cached refresh failures.                                                                                                                                                                                                                                                                                                                                         |
| Tabbed content         | [TabbedScreen](../src/lib/ui/screen/tabbed-screen.svelte)                                    | Supply unpadded content. Preserve the pager's scroll ownership.                                                                                                                                                                                                                                                                                                                                                                  |
| Section heading        | [Section](../src/lib/ui/section/section.svelte)                                              | Supply the heading and optional supporting content. Do not repeat local heading typography and spacing.                                                                                                                                                                                                                                                                                                                          |
| List row               | [Item](../src/lib/ui/item)                                                                   | Fill its media, title, description, and actions slots. Use `size="sm"` for dense lists.                                                                                                                                                                                                                                                                                                                                          |
| Form field             | `Field` with `FieldLabel`, `FieldDescription`, `FieldError`                                  | Keep the label visible and attach errors to their field. `FieldError` is `role="alert"`: use it only when it is the one alert on screen; otherwise render a plain `text-failed` paragraph and point the field at it with `aria-invalid="true"` and `aria-errormessage`.                                                                                                                                                          |
| Preference value       | `Field orientation="horizontal"`                                                             | Supply the label, value or control, and optional actions. Name each interactive control explicitly.                                                                                                                                                                                                                                                                                                                              |
| Toggle preference      | `FieldLabel` wrapping `Field orientation="horizontal"` with stock `Switch`                   | Supply a clear label and current value. The label row receives the tap.                                                                                                                                                                                                                                                                                                                                                          |
| Short exclusive choice | `ToggleGroup`                                                                                | Supply stable values and labels. Use it for a preference, not for navigation.                                                                                                                                                                                                                                                                                                                                                    |
| Navigation             | `Sidebar` (`SidebarMenuButton`, `SidebarGroupLabel`, `SidebarMenuAction`)                    | Follow the shell geometry in the [channel rules](channel-interaction-rules.md#shell-sizing-rules).                                                                                                                                                                                                                                                                                                                               |
| Secondary commands     | [ActionMenu](../src/lib/ui/menu/action-menu.svelte)                                          | Group related actions. Open an editor only after the owner selects Edit or Rename.                                                                                                                                                                                                                                                                                                                                               |

`Page.Body` centers content at `max-w-3xl` for `reading` and spans the inset for `full`.
A sticky footer is a `ScreenFooter` passed as the Screen's `footer`: it draws the full-bleed top border and lines its `flex flex-col gap-2 px-4 py-3 md:px-6` contents up with the body measure. Footers bring no border or gutters of their own.
The header `subtitle` clips text sideways only. `Page.Header` owns the vertical reach of a `Button` in it: on coarse pointers its `::after` runs from the button's top edge, which is the title's bottom, to 4px below its face, which is the header's bottom edge. That keeps it off the title and off the content below. The thread memory link is 28px tall on touch, an exception to the 44px rule, and callers add no hit-area classes.
It owns gutters and section rhythm. Embedded content adds no competing outer geometry.
Chat transcripts, the workspace shell, and tab pagers retain their specialized scrolling layouts.

The normal button uses 14px medium labels, shared corners, a short color transition, and a stationary press state.
Button sizes are stock: `xs` 24px, `sm` 28px, default 32px, `lg` 36px; icon sizes are 24, 28, 32 and 36px.
Input, Textarea, Switch, Checkbox and Radio are stock nova. Input is `h-8`, with 16px text below `md`, and has no `::after` hit box.
Every Button size carries an `any-pointer-coarse:after:` hit box reaching 48px tall, with at most 8px of horizontal inset. Switch and RadioGroupItem keep their stock `after:` and grow it on coarse pointers inside the primitive: Switch `any-pointer-coarse:after:-inset-y-4`, Radio `any-pointer-coarse:after:-inset-x-3.5`, plus `-inset-y-4.25` only in a horizontal group, because its 16px face needs both axes to reach 40 by 48px and a stacked group's 8px gap leaves no room above or below. Callers add no hit-area classes. Checkbox adds `any-pointer-coarse:after:-inset-y-4` on the control itself.
A RadioGroupItem inside a `FieldLabel` with a matching `for`/`id` points `aria-labelledby` at that label itself, because axe-core does not read label text inside the `role="group"` Field; do not add `aria-labelledby` at the call site.
`Spinner decorative` is for a spinner beside text that already says what is happening (Saving…, Loading older days…); it hides the icon from assistive tech. Without it the stock `role="status"` and `aria-label` stay. The primitive stops spinning under reduced motion.
Small icon glyphs do not justify small touch targets. Label every icon-only action.

Use a horizontal `Field` to align labels, values, and optional actions.
Give each input or option group an accessible name through `FieldLabel` or `aria-label`.
Use `Section title="…"` for related content, with optional `description`, `icon`, `count`, or `aside`.
Use `tone="list"` for quieter collection headings; its `px-3` lines the heading up with stock `Item` rows. Section counts are decorative, not a replacement for meaningful text.
Separate list rows sit in a stock `ItemGroup`. Flush rows in one bordered box use `ItemGroup variant="bordered"`, which drops the gap, rounds and clips the box, insets row focus rings and draws a rule between children. Wrap each row in `<div role="listitem">` so the rule shows; rows add no `rounded-none`, separators or gap overrides, and do not combine it with `Item variant="outline"`. Link rows in a group are contiguous rows: they get no `after:` and are at least 44px tall on coarse pointers (`any-pointer-coarse:min-h-11` when one line of content is shorter).
Use on-demand editors with Save and Cancel for routine preferences.
Preserve drafts after failed or in-flight saves. Return focus to Edit after the editor closes.
Use quiet text and icons for secondary states. Reserve strong color for meaning and recovery.
Use borders to separate groups, not to box every label and value.

Keep Add actions above their collection. Keep pagination and secondary actions at intrinsic width.
Full-width actions require a specific workflow reason, such as a phone sheet footer.
Workspace destinations use global navigation. Detail and creation pages link back to their named parent.

Before extracting another primitive:

1. Check whether shadcn-svelte ships it (the component list and the blocks). Add it with the CLI first.
1. Find repeated intent in existing callers. Do not abstract a single unusual layout.
1. Put domain-free geometry, states, and interaction defaults in `ui/`.
1. Keep data fetching, domain labels, and mutations in the feature.
1. Migrate the matching callers and remove their repeated classes.
1. Document the contract here and add regression coverage for behavior that can break.

Check: `review` rejects repeated outer gutters, per-page button heights, descendant-selector styling of shared controls, and unexplained full-width actions.
Check: `pw` hit probe (`e2e/hit-probe.ts`) on every changed control in a touch context.

### Tabs, swipes, and scroll ownership

- **Reuse the shared tabbed screen.** Use [TabbedScreen](../src/lib/ui/screen/tabbed-screen.svelte) for tabs with swipe navigation. It owns the screen shell, full-width pager, gutters, and panel scrolling. The import boundary check blocks direct feature imports of the pager engine.
- **Move panels with the finger.** Snap to the destination after release. Move the underline with the finger during a held swipe, then mark the destination on release. A phone tab tap updates the selected label and underline immediately while the panel moves. Desktop and fine-pointer tab changes switch panels instantly.
- **Keep labels readable.** When labels do not fit, allow horizontal scrolling within the tab bar. Keep the full label instead of an ellipsis. Keep the document width within the viewport.
- **Keep one vertical scroll owner per panel.** `TabbedScreen` disables outer scrolling and keeps the screen header and tab bar fixed. Supply content without an enclosing screen or extra vertical scroll container.
- **Preserve panel state.** Retain each panel's scroll offset, expanded rows, search input, and loaded older pages across tab changes.
- **Keep content stable during motion.** Commit filter requests after the destination panel settles. Keep loaded panels mounted during background refreshes. Do not rebuild the pager when text, content height, or keyboard height changes.
- **Recover interrupted gestures.** When the app loses focus or becomes hidden, release the gesture and align the committed panel. Do not leave the pager between tabs after an interrupted touch.
- **Keep focus within its intended area.** Reveal selected tabs through the tab bar's scroll offset. Do not use `scrollIntoView()` to move ancestor containers. Use `preventScroll` when keyboard navigation moves focus.
- **Keep spacing consistent.** `TabbedScreen` keeps the tab pager full width and pads the lead and each panel with the `Page.Body` gutters (`px-4 pt-4`, `md:px-6 md:pt-6`). Line-variant triggers keep the stock height, plus `any-pointer-coarse:h-10`. Supply lead and panel content without outer padding. Set `measure="full"` for dense desktop content such as long run lists. Keep padding inside cards.
- **Keep secondary buttons within content.** Give pagination and optional tracking buttons their content width. Keep optional MCP tracking controls below the Tools list. Do not change panel height through a footer that appears on one tab.
- **Keep other gestures available.** Preserve vertical scrolling, text selection, text input, and horizontal code scrolling. Reserve the screen edges for the drawer and system navigation.

The browser checks in `e2e/tab-swipe.test.ts` cover drag movement, snapping, keyboard navigation, reduced motion, retained state, and delayed refreshes. The connector checks also cover stable panel height. Every pager screen has alignment and scroll ownership checks at 320px and 412px. For each new pager screen, add a case to this shared usage check.

### Loading and background refresh

Treat first loads, background refreshes, and pagination as separate states. Cached content remains useful while a refresh runs.

| State                               | UI behavior                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| First load without content          | Keep the header and controls visible. For a noticeable wait, use delayed placeholders that match the row layout.          |
| Background refresh with content     | Keep cached content visible and mounted. Do not insert “Loading” or “Updating” text above existing rows.                  |
| Pagination                          | Show progress inside the existing “Show older” button. Keep its position stable. Append the new rows below existing rows. |
| Refresh failure with cached content | Keep the cached rows visible. Show the error and retry action below the list.                                             |
| First load failure                  | Show the error and a retry action in the content area.                                                                    |

Do not replace cached rows with skeletons during a refresh. Do not add a blocking spinner for routine background work. Use accessible status text without a layout change when an announcement is useful.

Fast requests do not need a flashing indicator. NN/g advises against skeletons and spinners for loads under one second. Apple recommends background loading that preserves access to other actions. These sources guide the interaction pattern, not a universal timeout.

Verification covers row positions before and after delayed refreshes. It also covers a data update during a held swipe and filter requests after panel arrival. Review mobile captures at 320px and 412px, plus desktop captures in both themes.

## UX writing

- **Chat toasts appear below the header and take up their own space.** Use `Screen` with `toastPosition="top"` for update prompts and transient chat feedback. Keep messages, approvals, and the composer unobscured. Check: `pw` (`e2e/app.test.ts`, `e2e/location-flow.test.ts`).

- **Plain verbs that name the action: "Approve and send", "Retry send", not "Submit" or "OK".** Why: the button should say what happens. Check: `review`.
- **Say "you" and "the agent"; no "we", no chirpy filler, no emoji in UI chrome.** Why: it's a tool, not a mascot. Check: `review`.
- **Errors say what happened and the next step, in one sentence each.** Why: users act on errors, they don't study them. Check: `review`.
- **Relative times for today ("2 min ago", "09:14"), full dates beyond.** Why: scannable and unambiguous. Check: `review`.

### Copy accuracy and dates

- **Use one term for each concept.** Why: different names for the same state suggest different behavior. Check: `review`: labels agree across navigation, list rows, detail views, and notifications.
- **Write one idea per sentence in active voice.** Why: direct instructions reduce rereading. Check: `review`: helper text names the action without filler or internal implementation terms.
- **Use input-neutral wording.** Why: people use touch, keyboards, and assistive technology. Check: `review`: instructions say “Select” rather than assuming a mouse click.
- **Do not promise unimplemented behavior.** Why: copy can create false expectations about permissions, completion, delivery, or recovery. Check: `review`: each claim matches the current behavior; unresolved decisions stay in technical notes.
- **Make date ranges compact and unambiguous.** Why: repeated timestamps obscure the difference. Check: `shot`: same-day ranges show the date once; cross-day ranges show both dates; seconds appear only when useful.
- **Keep timezone meaning consistent.** Why: the same instant can belong to different calendar days. Check: `review`, `pw`: displays use shared `ui/format/time.ts` helpers, identify non-local schedule zones, and cover midnight and daylight-saving boundaries when relevant.

## Accessibility

Target: WCAG 2.2 AA. The criteria that matter for this app, and how each is checked:

| Criterion                               | Where it bites here                                                                                                            | Check                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| 1.1.1 Non-text Content (A)              | Icon-only buttons (send, back, copy, overflow) need a name                                                                     | `axe`, `check`                       |
| 1.3.1 Info and Relationships (A)        | Message list is a list; approval card is a labeled region                                                                      | `axe`, `review`                      |
| 1.4.1 Use of Color (A)                  | Status pills, diff lines                                                                                                       | `review`                             |
| 1.4.3 / 1.4.11 Contrast (AA)            | Muted text, `*-soft` pills, borders, both themes                                                                               | `axe` light + dark                   |
| 1.4.4 Resize Text (AA)                  | Android font scaling                                                                                                           | `phone`                              |
| 1.4.10 Reflow (AA)                      | Code, long URLs, tables at 320px                                                                                               | `pw` reflow                          |
| 2.1.1 Keyboard (A)                      | Approval tabs, tool rows, sheets on desktop                                                                                    | `review`, manual keyboard pass       |
| 2.2.1 Timing Adjustable (A)             | Approval cards and toasts that need action never expire                                                                        | `review`                             |
| 2.4.3 Focus Order / 2.4.7 Focus Visible | Sheets trap and return focus; `:focus-visible` ring stays                                                                      | manual keyboard pass                 |
| 2.4.11 Focus Not Obscured (AA)          | Sticky composer vs focused items                                                                                               | `phone`, `scroll-padding`            |
| 2.5.7 Dragging Movements (AA)           | Swipe actions need a button alternative                                                                                        | `review`                             |
| 2.5.8 Target Size (AA)                  | 24px floor; invisible 48px-tall coarse-pointer hit boxes (face plus 8px exclusive along stock-gap rows, 48px in decision rows) | `axe` `target-size` + `pw` hit probe |
| 4.1.2 Name, Role, Value (A)             | Custom tabs, `div` dialogs, switches                                                                                           | `axe`, `check`                       |
| 4.1.3 Status Messages (AA)              | Delivery states, "Reconnecting", "Agent replied"                                                                               | `review` of `role="status"`          |

### axe setup

axe-core's `target-size` rule ships `enabled: false`, even under the `wcag22aa` tag, so enable it explicitly. **Call `.options()` before `.withTags()`**: `options()` replaces the whole options object, so called after `withTags()` it silently drops the `runOnly` tag filter (see `AxeBuilder` in `@axe-core/playwright` 4.13).

```ts
import AxeBuilder from '@axe-core/playwright';

const results = await new AxeBuilder({ page })
	.options({ rules: { 'target-size': { enabled: true } } }) // must come first
	.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
	.analyze();
expect(results.violations).toEqual([]);
```

- **Run axe on every screen in both themes and after driving each interactive state (sheet open, approval editing, tool row expanded).** Why: axe sees only the DOM present at `analyze()` time. Check: the e2e suite.
- **Reflow assertion at 320 and 412 wide: `document.documentElement.scrollWidth <= clientWidth`.** Why: 320 is WCAG 1.4.10's number (1280px at 400% zoom); 412 is the target phone. Check: `pw`.
- **`bun run check` runs with `--fail-on-warnings` so compiler `a11y_*` warnings fail the build.** Why: the Svelte compiler is the only a11y linter for templates; eslint-plugin-svelte has none. Check: `check`.
- **Review what automated scans cannot judge.** Why: a valid label can still be misleading, and hidden states escape a static scan. Check: `review`, keyboard pass: meaningful names, reading order, focus return, understandable errors, and hover/active-state contrast.
- **Screen-reader labels are real words: "Send message", "Back to Threads", "Copy code". Never "button", "icon", or the tool's internal name alone.** Why: axe checks that a name exists, not that it's useful. Check: `review`, plus a TalkBack pass on the phone for each new screen.

## The UX gate

Run the automated gates before visual review. Keep physical-device findings separate from browser results.

1. **Run the web gates:** `bun run check`, `bun run lint`, `bun run build`, and `bun run test:e2e`.
2. **Review changed patterns across inputs:** touch at 320px and 412px, desktop with a fine pointer, and a wide mixed-input device. Check both themes, keyboard focus, reduced motion, and 200% text size.
3. **Capture relevant states:** use the state matrix below. Review alignment, hierarchy, target geometry, scrolling, and state preservation. A shared primitive change needs representative callers beyond the original feature.
4. **Check device behavior:** use the installed PWA for keyboard, system gestures, safe areas, and thumb reach. Record checks that require owner device access. Do not claim them from desktop automation.

The first visual round collects defects across sizes and themes. One repair batch addresses them. A second round confirms repairs and records remaining limitations.
Existing regression suites cover target geometry, reflow, accessibility, and interaction behavior. Add focused assertions for changed contracts instead of duplicating implementation classes in tests.

### State matrix

Capture each screen that changed in every state that applies, at 412x915 unless noted:

| State        | How to produce it                                               |
| ------------ | --------------------------------------------------------------- |
| Empty        | Fresh fixture with no data                                      |
| Loading      | Fixture server delays responses 3s                              |
| Error        | Fixture server returns 500 / the tool step fails                |
| Offline      | `context.setOffline(true)` after load                           |
| Long content | 200-column code line, 5 KB message, 60-char unbroken URL, table |
| Desktop      | Fine pointer and hover, plus a separate wide touch context      |
| 320px        | Viewport 320x640                                                |
| Dark         | `colorScheme: 'dark'` (and light for every other row)           |
| Keyboard     | `phone` only: composer focused, screenshot from the device      |

### What blocks a milestone

A UX bug blocks when any of these is true:

- A check in this doc fails (axe violation, a target under 24px anywhere, a coarse-pointer hit area under 44px other than the exceptions documented above (line-variant tabs at 40px, the row axis of stock-gap rows at face plus 8px, `sm`/`xs` buttons at face plus 16px wide, stock `SidebarMenuAction`, a header subtitle control at 28px, and full-width Input and Textarea), overflow at 320px, the scroll-jank test).
- Data loss: a typed message, a draft edit, or a pending approval can disappear without the user choosing it.
- A blocking wait, failure, or required action has no visible feedback. Cached background refreshes can remain quiet.
- Back does the wrong thing (exits the app, skips a screen, leaves an overlay open).
- The keyboard covers the composer or the focused field.
- A notification lands anywhere but the exact item.
- Something reads "done" or green when the evidence doesn't back it.
- The owner hit it twice while dogfooding.

Everything else (spacing, wording, a slow-but-in-budget moment) is filed and fixed within the milestone if cheap, otherwise logged for the next.

## Anti-patterns

Seen in open-source agent UIs and chat apps. Don't ship any of these.

- **Raw tool JSON inline in the transcript** by default. Collapse it; the answer is the content.
- **A bare spinner or "Thinking…" with no step** for more than 2s.
- **Green "completed" for a run that only exited** without an error. Show evidence or `unverified`.
- **Auto-scroll that yanks the reader to the bottom** on every token.
- **Approval prompts that paraphrase the action**, time out, or vanish after a reload.
- **Uniform approval prompts for everything.** Approval fatigue trains click-through; ask only by exception and show why this one asked.
- **Layouts that ignore input or available space:** oversized desktop actions, undersized touch targets, hover-only actions, and tooltips as the only label.
- **Enter-to-send on mobile**, and composers the keyboard hides.
- **Silent reconnects** that lose or duplicate messages, or a "please refresh" banner instead of resuming.
- **Notifications for every message**, or notifications that open the app's home.
- **Settings dumped as a raw JSON editor** as the only way to change something common.
- **Blocking dialogs for routine reading.** Use the shared responsive sheet for detail, or the docked inspector when available. Keep confirmation dialogs for decisions.
- **History that can't be searched or linked**: every run, approval and memory change needs a URL.

## Prototype limits

The board renders shared feature screens, but fixtures do not prove live integration or complete state coverage.
Screens without a backend remain development previews.
Browser automation does not establish physical keyboard behavior, thumb reach, or subjective motion quality.
Record untested device behavior explicitly. Do not describe an automated pass as a completed phone review.

## Sources

- Targets: [WCAG 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [Apple HIG accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [Tailwind pointer variants](https://tailwindcss.com/docs/hover-focus-and-other-states#pointer-and-any-pointer), [shadcn-svelte blocks](https://shadcn-svelte.com/blocks)
- Android: [API defaults, 48dp targets](https://developer.android.com/develop/ui/compose/accessibility/api-defaults), [Touch target size](https://support.google.com/accessibility/android/answer/7101858)
- Loading: [Apple loading guidance](https://developer.apple.com/design/human-interface-guidelines/loading), [NN/g skeleton and progress guidance](https://www.nngroup.com/articles/skeleton-screens/), [SWR first-load and refresh states](https://swr.vercel.app/docs/advanced/understanding)
- Material 3: [Easing and duration tokens](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs)
- Chrome: [Viewport resize behavior (`interactive-widget`)](https://developer.chrome.com/blog/viewport-resize-behavior), [Edge-to-edge on Android](https://developer.chrome.com/docs/css-ui/edge-to-edge)
- Close requests and text scaling: [MDN CloseWatcher](https://developer.mozilla.org/en-US/docs/Web/API/CloseWatcher), [MDN `<meta name="text-scale">`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/text-scale)
- Performance: [web.dev INP](https://web.dev/articles/inp), [web.dev LCP](https://web.dev/articles/lcp)
- WCAG: [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/), [Understanding 2.4.11 Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
- axe: [`@axe-core/playwright`](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright), [axe-core rule descriptions](https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md)
- One-handed use: [Hoober, How do users really hold mobile devices](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php)
- Agent products: [Claude routines](https://code.claude.com/docs/en/routines), [ChatGPT Dots](https://learn.chatgpt.com/docs/dots), [Grok Bot approvals](https://docs.x.ai/grok-bot/approvals-security-and-privacy)

## Tasks beside chat

The side panel has two tabs: **Tasks** and **Agents** ([Agents](agents.md)).

Use the task workspace for conversation-scoped assignments.
On desktop, the right panel shares the available width with chat.
On mobile, the panel slides into view and chat becomes inert until the panel closes.
Keep drafts and task conversations mounted across panel changes.
Reserve screen edges for system gestures and ignore swipes that start on interactive controls.
Manual task creation saves a to-do without starting work.
Keep checklist completion separate from execution status.
See [Tasks](tasks.md) for lifecycle and storage behavior.

### Activity and conversation links

Activity rows represent execution attempts. Use Assignments for agent and scheduled runs, Replies for conversation turns, and All for the complete log. Saved assignments remain in Tasks. Keep rows to a title and a metadata line; the full brief belongs in Details.

Use “Jump to conversation” for links from execution records or task inspectors to chat. The shared conversation URL helper handles Main, topic, and task conversations and preserves the originating turn. Parent and delegated execution links belong in Details. Keep one conversation jump in the execution header; avoid competing parent-navigation actions there.
