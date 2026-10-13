# Coding agents

Sushii can start Codex and Claude Code sessions on the owner's connected machines (`coding_agent`).
The app calls them agents. This page defines where they appear and how the owner reads, answers, steers and stops them.
The [UX guidelines](ux-guidelines.md) own shared controls, sizing and accessibility. The [channel rules](channel-interaction-rules.md) own the panes.

## Where agents live

| Surface      | What it shows                                                                                               | Opens                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Side panel   | The **Agents** tab beside **Tasks**, scoped to the conversation; one control widens it to all conversations | The agent's detail                         |
| In-chat card | One compact card per agent, under the message whose `coding_agent` call started it                          | The agent's detail                         |
| Agent page   | `/agents/:id`, the same detail as a full page                                                               | Reached from phones and **Open full page** |

- **Desktop** (docked inspector): the detail replaces the list inside the panel, with **Back to agents**. The chat stays mounted beside it.
- **Phone**: the list opens in the slide-in inspector. Selecting an agent first closes the inspector's history entry, then pushes `/agents/:id`. Back returns to the conversation with the panel closed.
- Agent approvals are not listed in the Conversations **Needs you** section; the panel badge, the header dot and the push notification lead to them.
- There is no strip of agents above the composer. The header's panel button keeps the **Tasks** label and gains a dot while an agent request waits. Opening the panel then lands on **Agents**.
- A card links to its agent through the tool call id recorded at start. An agent with no recorded call has no card and lives only in the panel.

Check: `pw` (`e2e/agents.test.ts`).

## List

Groups appear in this order, hidden when empty. Each group shows its count.

1. **Needs you**: pending approvals first, then failed, interrupted and stalled agents. Newest first.
2. **Working**: running agents, newest activity first.
3. **Finished**: completed and stopped agents, newest first, 20 at a time with **Show older**.

Row anatomy is identical in the panel and the in-chat card (the card adds a border):

```
[icon] Title ........................ age
       Status label · request, step, error or outcome
       Provider · machine · folder
```

- Status is an icon **and** a text label, never colour or shape alone.
- Age runs while the agent is live and freezes at the run's length once it ends.
- A finished agent the owner has not opened on this device shows a dot with the text "New result". The dot never marks a pending request.
- The second line is agent-written text (activity, error); it renders as plain text.

| Session state      | Label                 | Status key       | Group     |
| ------------------ | --------------------- | ---------------- | --------- |
| `needs-you`        | Needs approval        | `waiting`        | Needs you |
| `running`, stalled | No recent output      | `stale`          | Needs you |
| `running`          | Running               | `running`        | Working   |
| `failed`           | Failed                | `failed`         | Needs you |
| `interrupted`      | Interrupted           | `failed`         | Needs you |
| `completed`        | Finished · Unverified | `done` (neutral) | Finished  |
| `stopped`          | Stopped               | `aborted`        | Finished  |

A completed session is not evidence that the work is right, so finished rows are neutral and say "Unverified".

Empty collection: "No coding agents in this conversation" with what will appear there.

## Badge

The Agents tab badge and the header dot count **pending request ids**, not agents (channel rule C5).
Failed and stalled agents sit in Needs you but add nothing to the count.

## Detail

One component serves the panel and the page.

1. **Header**: back control, title, status pill with age, provider · machine · folder, a secondary **Stop** while the agent is live, and an action menu (Jump to conversation, Open full page, Copy folder path).
2. **Transcript** (`role="log"`, oldest first), one block per turn:
   - the prompt as an outgoing message labelled **From you** or **From Sushii**;
   - one collapsible work group, `Worked 2m 14s · 9 commands · 3 files · 1 failed`;
   - the turn's answer as markdown (Codex's `final_answer`, Claude's result, else the turn's last message);
   - a failed or interrupted turn ends with its error; a stopped turn says so.
3. **Composer**, pinned at the bottom and named "Message ‹title›".

A session from a machine without transcripts shows its raw output as one **Activity** block, followed by its final message.

### Work groups

- Rows stay individual and chronological inside the group: command (`exit N` as text), file change (added, changed, deleted, moved), tool call, the agent's commentary, and answered approvals as a quiet status.
- A command or tool row expands to its full command and the tail of its output.
- The group is open while its turn runs and when it holds a failure; otherwise it is collapsed. The summary line names the failure count, so a failure stays visible while collapsed.
- The disclosure is a button named by its contents: "Turn 3 work: Worked 41s · 4 commands".

### Approvals

- A pending request renders once, as a card at its place in the transcript, after its turn's work group.
- The card names the action ("Run a command", "Change 2 files", "Allow network access to example.com"), shows the exact input in monospace, where it runs, and the provider's reason labelled **Agent's explanation**. A risk line appears for network access, writes outside the folder and deletions.
- **Deny** comes first and **Approve** is the wide control. A separate switch, off by default, also allows matching requests until the turn ends. The daemon runs one provider process per turn, so no grant outlives the turn.
- While an answer is in flight, the clicked control reads **Submitting…** and every decision is disabled.
- Questions and tool input requests can only be declined from the app; the card says so.
- When the card is scrolled out of view, a pointer above the composer reads "1 approval pending · Review". It scrolls to the card and focuses its heading; it carries no decision controls.
- The composer stays editable but cannot send while a request is pending, and says why.

## Steer and stop

- While a Codex agent runs, a message joins its current turn. While a Claude Code agent runs, a message stops the turn and continues with the message. The placeholder states which applies. An idle agent resumes with the message.
- **Stop** sits in the header, never in the send position. After Stop, focus returns to the composer.

## Navigation and notifications

- A notification link is the conversation URL with `?agent=<id>`. The parameter is removed with a replacing navigation, so Back never reopens it. Desktop then opens the panel on that agent; phones push `/agents/:id`.
- Any explicit open (notification, card, row) brings the pending request into view and focuses its heading, never **Approve**.
- A cold-opened agent page's Back goes to the agent's conversation.

## Accessibility

- The transcript is `role="log"` with `aria-live="off"`; a separate polite status announces state changes only ("Fix login needs approval", "… finished").
- No focus moves when a request arrives.
- Rows are links; actions are buttons. Buttons paint stock sizes and extend a 48px hit area on coarse pointers; list rows size their own box ([Reach and touch targets](ux-guidelines.md#reach-and-touch-targets)).

Check: `pw` and axe at 320, 390 and 1280 px (`e2e/agents.test.ts`).

## Precedent

The patterns above follow these documented products, as checked on 2026-10-12:

- Card in the parent conversation, detail in a side pane, approvals answered inside the child: [Claude Projects](https://code.claude.com/docs/en/claude-projects).
- Groups by state with needs-input first, frozen age, current activity in the row: [Claude Code agent view](https://code.claude.com/docs/en/agent-view).
- Agent session inside the originating object with a status row and the current action: [Linear agent interaction](https://linear.app/developers/agent-interaction), [Linear agent signals](https://linear.app/developers/agent-signals).
- "Worked for 6m 53s" per turn: [Codex IDE](https://learn.chatgpt.com/docs/ide). Unread, running and waiting views: [Codex notifications](https://learn.chatgpt.com/docs/notifications).
- Subagent cards that open the child transcript: [Cursor mobile](https://cursor.com/docs/cloud-agent/mobile.md).
- Collapsed step-by-step work: [Amp](https://ampcode.com/news/less-noise).
- Narrowest approval scope, once or for the session: [Codex sandboxing](https://learn.chatgpt.com/docs/sandboxing); broader options only when they can be shown: [Claude Code permissions](https://code.claude.com/docs/en/permissions).
- Compact width shows list or detail, Back returns to the list: [Android list-detail](https://developer.android.com/develop/adaptive-apps/guides/canonical-layouts). Prolonged flows avoid sheets: [Apple HIG sheets](https://developer.apple.com/design/human-interface-guidelines/sheets).
- Live transcripts as `role="log"` and status messages without focus: [MDN log role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/log_role), [WCAG 4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
