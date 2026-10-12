# Channel navigation and interaction rules

Sushii uses channels for parallel conversations and an inspector for supporting details.
This specification governs the workspace revision and its motion prototype.
The production shell still uses its existing layout. The prototype establishes the new motion and layout behavior.
The desktop and mobile layouts preserve the same conversation, draft, requests, and task state.

The primary jobs are reopening recent conversations and responding to requests.
Projects group channels and shared context. Projects do not own transcripts.
Main remains a standalone channel. Message-level threads remain outside this revision.

## Evidence and design choices

The research date is October 11, 2026. Product documentation describes behavior, not proof of universal usability.
Historical examples explain an interaction. They do not establish the current behavior of every app version.
The rules in this specification are Sushii requirements derived from the accepted brief and the evidence below.

| Evidence                                                                                                                                                                                                        | Finding                                                                                                                       | Sushii consequence                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [Discord panel engineering, July 2020](https://discord.com/blog/how-discord-made-android-in-app-navigation-easier)                                                                                              | Discord used overlapping panels and a visible chat surface. Its team replaced slow physics flings with fixed-duration easing. | Chat follows the finger. Release has a short, bounded settle. A visible chat portion provides a return target.                    |
| [Discord mobile layout](https://support.discord.com/hc/en-us/articles/12654190110999-New-Mobile-App-Updates-Layout)                                                                                             | Later navigation assigns message swipes to replies and opens channel details through the header.                              | The earlier panel interaction is inspiration. Sushii defines gesture ownership explicitly and keeps visible navigation controls.  |
| [Discord design update, August 2026](https://discord.com/blog/improving-mobile-with-squircles-styles-and-spacing)                                                                                               | Consistent shapes distinguish people from containers. Less frequent composer actions move into an attachment menu.            | Channel rows use restrained icons. The composer preserves writing space and separates frequent actions from secondary actions.    |
| [Slack sidebar](https://slack.com/help/articles/212596808-Adjust-your-sidebar-preferences)                                                                                                                      | App destinations and conversation sections have separate roles. Sidebar width can change.                                     | Workspace tools remain available below channel navigation. The inspector does not replace global navigation.                      |
| [Slack mobile organization](https://slack.com/help/articles/29788684062739-Customize-the-Slack-mobile-app)                                                                                                      | Conversations support alphabetical, section, and recent-activity organization.                                                | All provides stable project/channel organization. Recent provides an owner-visit shortcut. Background replies do not reorder All. |
| [Slack read preferences](https://slack.com/intl/en-gb/help/articles/360043037853-Manage-your-Mark-as-read-preference) and [Discord Inbox](https://support.discord.com/hc/en-us/articles/360045027712-Inbox-FAQ) | Read position and notifications support catching up across conversations.                                                     | Unread content and unanswered requests remain different states. Reading never resolves an owner decision.                         |
| [Material canonical layouts](https://m3.material.io/foundations/layout/canonical-examples/overview)                                                                                                             | List-detail and supporting-pane layouts adapt to available space.                                                             | Navigation, central chat, and optional inspector share one layout policy.                                                         |
| [W3C disclosure navigation](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/)                                                                                                | Disclosure buttons and links support grouped navigation without menu-widget semantics.                                        | Project headings expand channel links. Ordinary Tab navigation remains available.                                                 |
| [W3C tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)                                                                                                                                                      | Automatic activation assumes panels appear without noticeable latency.                                                        | Ordinary tabs reveal content promptly. They do not wait for a long carousel settle.                                               |
| [Bits UI Dialog](https://www.bits-ui.com/docs/components/dialog)                                                                                                                                                | Modal primitives manage focus, scroll locking, and dismissal.                                                                 | Compact inspectors use the existing sheet primitives. Docked inspectors remain nonmodal.                                          |
| [CSS container queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries)                                                                                                  | Components can respond to their container width.                                                                              | Pane decisions use workspace width rather than independent window breakpoints.                                                    |
| [Chrome keyboard viewport behavior](https://developer.chrome.com/blog/viewport-resize-behavior/)                                                                                                                | Keyboard behavior differs between visual and layout viewports.                                                                | The composer uses existing viewport, safe-area, and keyboard handling. Both Android and iOS require device checks.                |
| [Pointer touch behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action)                                                                                                    | Touch-action determines browser gesture handling.                                                                             | A horizontal pane gesture must preserve vertical scrolling, controls, and horizontal child scrolling.                             |
| [Browser animation performance](https://web.dev/articles/animations-guide)                                                                                                                                      | Transform and opacity avoid many layout and paint costs.                                                                      | Finger tracking updates transforms. Streamed text does not rebuild the pane layout.                                               |

## Current implementation evidence

The application uses local shadcn-svelte components, with Bits UI underneath many interactive primitives.
The custom `SwipeableTabs` component uses Embla 8.6.0 directly.
The task panel and navigation drawer use separate gesture handlers.

Three adjacent tab changes in a 412px Chromium preview took 600–616ms to align within 0.5px.
Two changes reached 90 percent after 283–296ms and 99 percent after 467–480ms.
Frame intervals remained approximately 17ms in those two runs.
The measured behavior has a long settling tail. These results do not measure physical-phone latency.
All 26 existing tab-swipe browser tests passed during this investigation.

[Embla v8 duration](https://www.embla-carousel.com/docs/v8/api/options#duration) controls attraction physics, not milliseconds.
That setting does not control drag-release duration.

## Navigation rules

| ID  | Requirement                                                                                                    | Verification                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| N1  | Give each channel one stable identity, transcript, draft, and request source.                                  | Open Main, an ordinary channel, and a task channel. Check history and draft isolation.                        |
| N2  | Keep project containers separate from channel transcripts.                                                     | A project heading expands links. It never opens an implied project chat.                                      |
| N3  | Keep Main visible outside project groups.                                                                      | Check empty, grouped, filtered, and archived views.                                                           |
| N4  | Preserve query, selected view, expanded groups, and list position across navigation.                           | Search, open a channel, and return through Back. Compare all retained values.                                 |
| N5  | Keep All stable. Sort Recent by owner visits.                                                                  | Deliver a background reply. Neither view reorders. An owner visit updates Recent only.                        |
| N6  | Keep Tasks, Activity, and Settings directly accessible. Place Memory, History, and Connectors under Workspace. | Reach each destination with touch and keyboard. Return to the same selected channel.                          |
| N7  | Keep channel selection separate from global destination selection.                                             | Open Memory from a channel. Return without a new channel or lost draft.                                       |
| N8  | Label search according to its actual coverage.                                                                 | Name/preview search never claims transcript search. Archived matching results identify their state.           |
| N9  | Use one channel row anatomy and distinct hover, selected, and focus states.                                    | Check Main and grouped channels in both themes. Align icons, labels, and badges; retain mobile touch targets. |

Search and view filters stay collapsed until requested. Channel links remain the main navigation surface.

Recent and All are alternate views of the same records. They do not duplicate conversation state.
Task work conversations enter the catalog when a work conversation exists. Unstarted to-dos remain in Tasks.
Existing task project records do not automatically become channel groups.

## Pane interaction rules

| ID  | Requirement                                                         | Verification                                                                                       |
| --- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| P1  | Keep one central conversation.                                      | Opening task details never embeds a second chat in the inspector.                                  |
| P2  | Move the chat with the finger when revealing navigation.            | Hold a partial horizontal drag. Compare pointer displacement and chat transform.                   |
| P3  | Keep a visible chat return target when navigation is open.          | The target measures at least 48px. Tapping it closes navigation.                                   |
| P4  | Use position and recent velocity to choose the release destination. | Test slow short drags, long drags, fast flicks, reversal, and both closing directions.             |
| P5  | Bound release settling. Keep drag tracking free of easing.          | Record release-to-alignment. Check the provisional timing budget below.                            |
| P6  | Open at most one compact side panel.                                | Open the inspector while navigation is open. Check that panels never overlap each other.           |
| P7  | Preserve vertical scrolling and horizontal child scrolling.         | Swipe a transcript, code block, table, slider, input, and an existing text selection.              |
| P8  | Reserve screen edges for system navigation.                         | Start gestures inside the reserved edge zones. Check that application transforms remain unchanged. |
| P9  | Restore the committed pane after cancellation or interruption.      | Trigger pointer cancellation, app backgrounding, resize, and orientation change mid-drag.          |
| P10 | Keep Back, Escape, and visible controls equivalent.                 | Close a panel once without leaving the selected channel or consuming two history entries.          |
| P11 | Keep the active chat mounted while its inspector opens.             | Preserve draft, selection, transcript position, and streaming state.                               |
| P12 | Coordinate pane modes through workspace width.                      | Resize across compact, two-pane, and three-pane modes. No invisible overlay retains focus.         |

The prototype starts with a navigation reveal width of the workspace width minus a 56px chat return target.
Its inspector reveal width leaves a 48px return target.
Three-pane desktop mode requires usable navigation, chat, and inspector widths.
The chat receives priority when the inspector cannot fit.
These values are Sushii prototype choices, not Discord specifications.

The prototype gesture starts after 10px of movement and a horizontal-to-vertical ratio of at least 1.5.
The release projection uses recent horizontal velocity and a 160ms projection horizon.
Opening requires half the panel width after projection. Closing requires a 64px inward drag, or an inward flick of at least 32px that projects past that threshold. Closing returns to chat rather than opening the opposite panel.
Sidebar links, buttons, and the exposed chat return strip accept horizontal dismissal gestures. A claimed drag cancels its synthetic click; normal taps, vertical scrolling, and editing controls retain their behavior.
Settlement uses a fixed 200ms ease-out transition.
Reduced motion uses immediate settlement.
The initial settle budget is 240ms in an idle browser, including frame scheduling.
Device profiling can change these values before production integration.

## Chat and attention rules

| ID  | Requirement                                                              | Verification                                                                                    |
| --- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| C1  | Group messages by sender with quiet timestamps and consistent alignment. | Review short exchanges, long replies, files, and interruptions in both themes.                  |
| C2  | Keep writing space available in the composer.                            | Check 320px width, attachments, voice controls, and three lines of input.                       |
| C3  | Place one factual activity line near the composer.                       | Replay thinking, response streaming, tool work, delegation, waiting, stopping, and idle states. |
| C4  | Distinguish unread content, active work, and pending decisions.          | Each state has a separate treatment and an accessible label. Color alone never carries meaning. |
| C5  | Count canonical pending request IDs.                                     | Link two agents to one owner decision. Check one request and one global count.                  |
| C6  | Keep the request ping until explicit resolution or withdrawal.           | Open and read the channel. The request count remains unchanged.                                 |
| C7  | Keep different approval actions separate.                                | Use different exact action arguments with similar titles. Check separate approval handles.      |
| C8  | Open the exact request from its ping or notification.                    | Follow a deep link, answer, and check resolution in every open view.                            |
| C9  | Preserve reading position during streaming and history loading.          | Read older content during a reply. Prepend older history without a viewport jump.               |
| C10 | Keep cached content visible during refresh.                              | Delay or fail a refresh. Check row positions and available actions.                             |
| C11 | Preserve explicit unknown states.                                        | A missing read receipt or activity snapshot never becomes zero unread or verified completion.   |
| C12 | Keep requests attached to their channel origin.                          | A scheduled follow-up or delegated result returns to the same channel.                          |

Thinking means response preparation. Typing means response text generation.
Tool work uses a factual label, such as “Checking deployment”.
Background delegation uses a compact count and an activity link.
Idle channels show no activity text. Screen readers receive state changes rather than animation-frame announcements.

## Implementation choices

| Interaction               | Primitive                                                                                            | Reason                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Workspace arrangement     | CSS Grid and one Svelte layout controller                                                            | The workspace owns pane widths and modes.                             |
| Channel destination       | Link and route state                                                                                 | Channel selection has history and deep-link meaning.                  |
| Project expansion         | Disclosure button                                                                                    | Group expansion is separate from destination navigation.              |
| Compact panel protection  | Existing routed sheet and Bits UI focus behavior                                                     | Focus and Back behavior remain consistent with the application.       |
| Inspector content         | Supporting pane with shared content                                                                  | Desktop and mobile show the same details.                             |
| Finger reveal             | Pointer events and transforms                                                                        | Drag displacement remains direct. Release time has an explicit bound. |
| Ordinary tabs             | Existing Bits UI tabs                                                                                | Selection does not depend on carousel arrival.                        |
| Activity filters          | Filter controls                                                                                      | Filtering a collection does not imply page navigation.                |
| Optional desktop resizing | [PaneForge through shadcn-svelte Resizable](https://www.shadcn-svelte.com/docs/components/resizable) | Resize handles support keyboard interaction.                          |

Embla remains suitable for actual carousels or a deliberately selected mobile pager.
It does not own channel routing, pane reveals, or ordinary filter selection.
Native CSS scroll snapping remains a comparison option for true sibling pages.

## Build sequence and gates

The isolated prototype route is `/interaction-lab` under `bun run dev:proto`.
Its automated browser checks run through `bunx playwright test -c interaction/playwright.config.ts`.
Its release rules have unit tests in `src/proto-routes/interaction-lab/pane-motion.test.ts`.

The live implementation uses `ui/shell` for navigation, chat, and inspector motion.
`ui/workspace/context.ts` lets a feature register supporting inspector content.
The shell owns both pane gestures. It preserves drafts and keeps vertical scrolling native.
Channel data lives in `features/channels`; the root route binds it to the presentational navigator.
All ordering remains stable. Recent ordering changes only after an owner visit.
The catalog and existing histories use the device's offline cache.
The `/chats` directory remains available for channel management and the shared inbox.
The right inspector renders task details, checklists, activity, and results.
Task conversations open centrally through an explicit channel link.
Project assignment is not available in the channel catalog yet.
The navigator groups ordinary channels and task channels without inventing project membership.

Mobile navigation first closes its shallow history entry, then pushes the destination route.
A temporary local state keeps navigation visible until that route mounts.
Replacing a shallow entry with another route can leave SvelteKit's navigation index unchanged.
Back must restore the rendered screen as well as its address; browser tests check both.
The shell reserves the outer 24px for system gestures and leaves tab pagers to their own engine.

### Shell sizing rules

The table defines Sushii conventions, rather than universal platform requirements.
[WCAG AA target guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
uses a 24px minimum with exceptions.
[Android guidance](https://support.google.com/accessibility/android/answer/7101858)
recommends 48dp targets and 8dp separation.
Our Android-first web app adopts 48 CSS pixels for touch targets.

| Area             | Rule                                                                                                                                                                   | Verification                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Touch targets    | At least 48px. Separate actions have 8px gaps; repeated channel rows are contiguous with inset visual highlights. Small badges remain informational.                   | Measure target rectangles at 320px, 412px, and wide touch layouts. Measure checkbox labels, not only their visual squares.  |
| Desktop density  | Channel rows may use 36px height and contiguous rows only in a wide layout with a fine pointer and hover. Any coarse pointer restores touch sizing.                    | Compare mouse-only and mixed-input desktops. This is a deliberate compact navigation exception to the mobile spacing rules. |
| Icon controls    | Square 48px targets, no text-button padding, 16px icons.                                                                                                               | Compare Menu, Details, and Close target rectangles.                                                                         |
| Gutters          | One 16px content gutter for transcript, request banner, inspector, and composer. Sidebar rows use 8px internal padding.                                                | Compare visible edges in all panes and both themes.                                                                         |
| Type             | Shared rem tokens: 15px body at 1.5 leading, 14px UI (16px touch navigation), 12px metadata, 13px code, and inputs at least 1rem.                                      | Increase root text to 200%. Check wrapped action labels and overflow.                                                       |
| Message rhythm   | 16px between messages; 8px between paragraphs.                                                                                                                         | Compare short exchanges and long replies without excessive empty space.                                                     |
| Inspector rhythm | 16px inset, 24px section separation, 8px below headings. Checkbox label targets remain at least 48px.                                                                  | Scroll to the last action in a short viewport.                                                                              |
| Viewport         | Let the heading occupy its actual height. The workspace fills the remainder with no hard minimum height. Use the visual viewport at normal zoom for keyboard overlays. | Check short heights and wrapped demo controls. Real phone keyboards remain a device gate.                                   |
| Insets           | Apply safe-area padding once at the outer frame.                                                                                                                       | Check portrait and landscape system insets.                                                                                 |
| States           | Keep the same row geometry across idle, hover, selected, and focus. Hover is quieter than selection; focus has its own outline.                                        | Compare Main and grouped channels across both themes.                                                                       |

The sidebar icon column is 20px on touch layouts and 18px on mouse desktops. Labels truncate before request badges.

The navigation proportions come from visual comparison with Slack's
[sidebar reference](https://slack.com/help/articles/212596808-Adjust-your-sidebar-preferences)
and Discord's [official appearance examples](https://support.discord.com/hc/en-us/articles/207260127-How-to-Change-Discord-Color-Themes-and-Customize-Appearance-Settings).
Their screenshots show tightly repeated channel rows, distinct section headings, and shallow selected highlights.
This is an interpretation of the screenshots, not an exact pixel specification from either product.
Discord also exposes navigation density separately from message density.
Our selected face is 40px inside a 48px touch row, or 32px inside a 36px mouse row.
The full row receives input. The selected background does not define the hit area.
Project disclosure uses a chevron and the same icon/text alignment as its channels.

Prototype explanations stay outside the composer and navigation footer.
Physical phone feel and keyboard behavior still need device review.

The additive backend provides a channel catalog and shared request discovery.
Read receipts remain unavailable in that catalog. The `unread` field is explicitly `null`.
Linked requests load earlier history pages until their card is found. Lookup stops on errors, exhausted history, or a bounded limit. Retry and Keep looking provide recovery without changing the draft.
Explicit decision keys prevent duplicate live owner questions.
Generic extension questions remain visible without automatic text-based merging.
New question handles survive crashes so restart can withdraw orphan questions.
Older unanswered log records have no recovery handle and can outlive their original dialog.
The future attention interface must distinguish these unresolved records from verified live requests.

1. Implement the additive channel catalog and shared request awareness independently of layout.
2. Build the isolated pane prototype from P1–P12.
3. Run synthetic gesture checks and record timing, displacement, and recovery results.
4. Inspect desktop and mobile layouts together in light and dark themes.
5. Validate the prototype on the installed PWA and a physical phone.
6. Extract the accepted pane primitive into the shared workspace shell.
7. Integrate channel navigation, inspector content, activity feedback, and request pings.
8. Run the repository web gates and real-system conversation flows.

The gesture prototype does not establish that subjective feel matches Discord.
Automated checks establish state transitions and timing bounds.
Physical-device use establishes thumb reach, keyboard behavior, and perceived motion.
Each unresolved device finding remains explicit until that check passes.

The inspection process has two bounded rounds.
The first round collects all defects across device sizes and themes.
One repair batch addresses those defects.
The second round confirms repairs and records remaining limitations.

The production gates remain in [UX guidelines](ux-guidelines.md#the-ux-gate).
The rules above supplement the existing 48px target, accessibility, offline, and data-preservation requirements.
