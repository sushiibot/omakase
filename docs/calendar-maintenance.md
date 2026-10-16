# Calendar maintenance

Home shows proposed calendar updates under Calendar updates. Watching shows the responsibility, its last review, and Pause or Resume.
The agent can also link a proposal from chat. Reviews use normal routes, so browser Back returns to the originating page.

The first adapter supports the official Fastmail MCP server at `https://api.fastmail.com/mcp`.
It adds exact email excerpts to existing event descriptions. It does not create events, change times, or update events with participants.
Fastmail warns that updates to events with invitees send notifications. This adapter refuses those events before preparing or executing a proposal.

Heartbeat reads connected sources and can prepare local proposals. Notification limits do not stop enabled maintenance reviews.
A proposal preserves the event ID, source email ID, excerpts, original notes, proposed notes, connector binding, and content fingerprints.
The model supplies a match reason. The owner reviews that match, event date, source subject, and exact notes before approving.
The host reads both records itself. Excerpts must occur in the source email, and existing notes remain intact.
Repeated or dismissed additions are suppressed for the same event. A newer proposal supersedes the previous pending proposal for that event.

Only the owner API can approve, dismiss, pause, resume, reconcile, or undo. Model tools cannot approve or execute proposals.
The gateway applies its normal owner authentication and same-origin checks. RPC handlers also check the principal.
The adapter fixes the provider and tool names. It checks the current schema and connector generation before dispatch.
Codemode can compose the preparation tools but cannot obtain the owner execution capability.

Execution checks the event and source again. It persists intent before writing and reads the event afterward.
Duplicate approval requests return the existing result. An interrupted write becomes uncertain and requires a read-only result check.
The service never automatically retries an uncertain write.
Undo restores the original notes only if the event still matches the verified result. Later owner changes block Undo.

Fastmail's current update tool does not expose a conditional version argument in this adapter.
Fresh reads detect intervening changes, but another client can still edit between the last read and the write.
Therefore this release requires exact owner approval and does not enable standing automatic writes.

State lives in `stateDir/maintenance.json`, outside model-writable files. Atomic replacement prevents torn records.
A process-wide service serializes preparation and execution. Pause takes effect during network reads and is checked again before dispatch.
The history is bounded to 500 proposals and approximately 800 KB. Reaching the bound stops preparation without deleting receipts.
A corrupt store fails startup instead of silently forgetting approvals or replaying writes.

Current limits:

- The responsibility is fixed to calendar-note enrichment. General responsibility creation and learned preferences are future work.
- Heartbeat uses bounded source searches. Provider cursors and push-triggered ingestion are not implemented.
- Last review means the review ran. It does not assert that every source was checked.
- Current adapters must recognize the provider schema and response shape. Unsupported responses fail without writing.
- Proposals expire after seven days. They cannot execute after dismissal, supersession, or expiration.

Tests cover provider argument construction, source verification, participants, duplicate decisions, stale edits, pause races, restart recovery, and conditional Undo.
Browser tests cover the full owner flow, native history, phone and desktop layouts, and accessibility.
Live validation reads connector metadata only. Test writes use fake providers, never personal calendar events.
