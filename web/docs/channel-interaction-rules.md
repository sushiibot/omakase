# Channel navigation and interaction rules

Sushii uses channels for parallel conversations and an inspector for supporting details.
This document defines workspace-specific behavior in the live shell and its isolated motion prototype.
The [UX guidelines](ux-guidelines.md) own shared controls, content geometry, accessibility, and review gates.
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
| [CSS container queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries)                                                                                                  | Components can respond to their container width.                                                                              | Pane contents respond to their container; pane docking uses the 768px and 1024px breakpoints.                                     |
| [Chrome keyboard viewport behavior](https://developer.chrome.com/blog/viewport-resize-behavior/)                                                                                                                | Keyboard behavior differs between visual and layout viewports.                                                                | The composer uses existing viewport, safe-area, and keyboard handling. Both Android and iOS require device checks.                |
| [Pointer touch behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action)                                                                                                    | Touch-action determines browser gesture handling.                                                                             | A horizontal pane gesture must preserve vertical scrolling, controls, and horizontal child scrolling.                             |
| [Browser animation performance](https://web.dev/articles/animations-guide)                                                                                                                                      | Transform and opacity avoid many layout and paint costs.                                                                      | Finger tracking updates transforms. Streamed text does not rebuild the pane layout.                                               |

## Historical investigation evidence

The October 11 investigation recorded the following baseline. These timings do not describe the current accepted tab behavior.

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
Archived channels have a separate collapsed section outside search controls. Search can reveal matching archived channels.
The owner can still collapse that section.

Channel menus open with actions, including Open conversation and Rename. Archive or Restore appears where supported.
Rename opens its editor only after selection. Main supports a saved display name and cannot be archived.

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

A coding agent's detail is the one exception to P1. On a docked inspector it shows the agent's transcript with its own composer, named "Message ‹agent title›" so it cannot be mistaken for the conversation's.
The central conversation stays mounted beside it (P11). On phones the agent detail is a full page, `/agents/:id`. See [Agents](agents.md).

The prototype starts with a navigation reveal width of the workspace width minus a 56px chat return target.
Its inspector reveal width leaves a 48px return target.
Three-pane desktop mode requires usable navigation, chat, and inspector widths.
The chat receives priority when the inspector cannot fit.
These values are Sushii prototype choices, not Discord specifications.

The prototype gesture starts after 10px of movement and a horizontal-to-vertical ratio of at least 1.5.
The release projection uses recent horizontal velocity and a 160ms projection horizon.
Opening requires a 64px outward drag, or an outward flick of at least 32px that projects past that threshold. Tiny movements cannot open either panel, and reversing a drag cannot open the opposite panel. Closing requires a 64px inward drag, or an inward flick of at least 32px that projects past that threshold. Closing returns to chat rather than opening the opposite panel.
Sidebar links, buttons, and the exposed chat return strip accept horizontal dismissal gestures. A claimed drag cancels its synthetic click; normal taps, vertical scrolling, and editing controls retain their behavior.
Settlement uses a fixed 200ms ease-out transition.
Reduced motion uses immediate settlement.
The initial settle budget is 240ms in an idle browser, including frame scheduling.
Physical-device profiling can justify changes to these values. Shared shell tests must retain the documented behavior.

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
Coding agents add nothing near the composer: their cards sit under the message that started them, and the panel button's dot marks pending agent requests (C5 counts request ids).
Idle channels show no activity text. Screen readers receive state changes rather than animation-frame announcements.

## Implementation choices

| Interaction               | Primitive                                                                                            | Reason                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Workspace arrangement     | shadcn-svelte Sidebar parts and one Svelte pane controller                                           | The workspace owns pane widths and modes.                             |
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
The navigator groups ordinary channels under Topics and task channels under Task channels, without inventing project membership.

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
Shell geometry follows the shadcn-svelte Sidebar parts.
On coarse pointers, navigation rows grow to 44px and separate controls carry invisible 48px hit boxes.

| Area             | Rule                                                                                                                                                                                                                                           | Verification                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Touch targets    | Navigation rows are `h-8`, with `any-pointer-coarse:h-11` (44px). Repeated channel rows are contiguous and carry no `after:` hit area. Separate controls carry invisible 48px hit boxes on coarse pointers. Small badges remain informational. | Hit probe at 320px, 412px, and wide touch layouts. Probe checkboxes, including their `after:` hit areas. |
| Density          | Stock `SidebarMenuButton` (`h-8 p-2 text-sm`) on any fine pointer, with no width condition. Any coarse pointer restores the touch row height.                                                                                                  | Compare mouse-only and mixed-input desktops.                                                             |
| Icon controls    | Stock `icon` and `icon-sm` buttons (32px and 28px), 16px icons, and a coarse-pointer `after:` hit box.                                                                                                                                         | Hit probe on Menu, Details, and Close.                                                                   |
| Group labels     | Stock `SidebarGroupLabel`: `h-8 px-2 text-xs font-medium`. Interactive group labels grow to 44px on coarse pointers, like rows.                                                                                                                | Compare project headings and section labels in both themes.                                              |
| Row actions      | Stock `SidebarMenuAction` over the row's right edge with a 16px icon. On coarse pointers it is always visible, 24px, with an `after:` hit area that spans the row height.                                                                      | Hit probe on the action and on its `SidebarMenuItem`.                                                    |
| Breakpoints      | Navigation docks at 768px and wider and collapses from the header's sidebar trigger, the rail, or Cmd/Ctrl+B; the inspector docks at 1024px and wider. Narrower layouts open them as panels.                                                   | Resize across 767/768px and 1023/1024px.                                                                 |
| Headers          | Navigation, chat, and inspector headers share `--header-height` (56px).                                                                                                                                                                        | Compare header bottoms with the inspector open.                                                          |
| Gutters          | One 16px content gutter for transcript, request banner, inspector, and composer. Sidebar rows use 8px internal padding.                                                                                                                        | Compare visible edges in all panes and both themes.                                                      |
| Type             | `text-sm` rows, `text-xs` group labels, 15px body at 1.5 leading, 13px code, and stock input text sizes.                                                                                                                                       | Increase root text to 200%. Check wrapped action labels and overflow.                                    |
| Message rhythm   | 16px between messages; 8px between paragraphs.                                                                                                                                                                                                 | Compare short exchanges and long replies without excessive empty space.                                  |
| Inspector rhythm | 16px inset, 24px section separation, 8px below headings. Checkboxes are stock, with the coarse-pointer `after:` hit area on the checkbox itself.                                                                                               | Scroll to the last action in a short viewport.                                                           |
| Viewport         | Let the heading occupy its actual height. The workspace fills the remainder with no hard minimum height. Use the visual viewport at normal zoom for keyboard overlays.                                                                         | Check short heights and wrapped demo controls. Real phone keyboards remain a device gate.                |
| Insets           | Apply safe-area padding once at the outer frame.                                                                                                                                                                                               | Check portrait and landscape system insets.                                                              |
| States           | Keep the same row geometry across idle, hover, selected, and focus. Hover is quieter than selection; focus has its own outline.                                                                                                                | Compare Main and grouped channels across both themes.                                                    |

Row icons are 16px on every input. Labels truncate before request badges.

The navigation proportions come from visual comparison with Slack's
[sidebar reference](https://slack.com/help/articles/212596808-Adjust-your-sidebar-preferences)
and Discord's [official appearance examples](https://support.discord.com/hc/en-us/articles/207260127-How-to-Change-Discord-Color-Themes-and-Customize-Appearance-Settings).
Their screenshots show tightly repeated channel rows, distinct section headings, and shallow selected highlights.
This is an interpretation of the screenshots, not an exact pixel specification from either product.
Discord also exposes navigation density separately from message density.
The selected background fills the row: 32px on fine pointers, 44px on coarse pointers.
The full row receives input.
Project disclosure is the group label itself, with a trailing chevron.

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

For changes to the shared shell:

1. Preserve channel identity, drafts, requests, and cached state.
2. Run gesture checks for timing, displacement, cancellation, and recovery.
3. Inspect desktop and mobile layouts together in light and dark themes.
4. Check keyboard and system gestures on the installed PWA. Record unavailable device checks.
5. Run the repository web gates and affected real-system conversation flows.

The gesture prototype does not establish that subjective feel matches Discord.
Automated checks establish state transitions and timing bounds.
Physical-device use establishes thumb reach, keyboard behavior, and perceived motion.
Each unresolved device finding remains explicit until that check passes.

The inspection process has two bounded rounds.
The first round collects all defects across device sizes and themes.
One repair batch addresses those defects.
The second round confirms repairs and records remaining limitations.

The production gates remain in [UX guidelines](ux-guidelines.md#the-ux-gate).
The rules above supplement the shared touch-target, accessibility, offline, and data-preservation requirements.
Shell navigation uses the Sidebar row geometry above. Routine content actions use the shared `Button` defaults.
