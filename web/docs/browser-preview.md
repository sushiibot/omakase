# Browser preview and saved logins

Main and topic chats show the browser screen above the conversation.
Chromium is the default engine. Camoufox is an optional fallback.
Chromium includes uBlock Origin Lite. Camoufox includes full uBlock Origin.
Proxies are not configured.

## Sign in

1. Ask the agent to open the site.
2. Expand the browser preview.
3. Select **Take control**.
4. Select a field on the page, or use **Next field**.
5. Enter text in **Text or password**.
6. Select **Send text**.
7. Use **Enter** or select a button on the page to continue.
8. Complete any additional sign-in steps.
9. Select **Return to agent**.

The agent waits while the owner controls the browser.
An action already in progress finishes before takeover completes.
Text input goes directly to the workspace browser, outside the chat transcript.
The local input clears after a successful send or when the viewer closes.
The displayed page can still show information entered into ordinary fields.

Closing or hiding the viewer does not return control to the agent.
Reopen the viewer to continue.
The owner can complete sign-in even if the agent run ends during takeover.
Returning control then closes the browser and retains its saved profile.

## Saved profiles

The default `owner` profile stores browser data under `WORKSPACE_STATE_DIR/browser-profiles/<engine>`.
That directory must remain on the durable workspace volume.
Browser process cleanup does not delete the profile.
Chromium and Camoufox use separate profiles; each engine can require an initial sign-in.
Sites can expire or revoke saved logins.
Camoufox also saves its generated fingerprint in `identity.json`.
Profiles contain credentials and must stay outside source control and chat attachments.

One task can use each saved profile at a time.
Other tasks wait up to two minutes before receiving a busy error.
Temporary profiles allow independent research in parallel, without saved logins.
Tasks must close their current session before switching engine or profile.

## Agent commands

The `browser` tool accepts command arguments and optional `engine` and `profile` fields:

```json
{"args":["open","https://example.com"]}
{"args":["snapshot","-i"]}
{"args":["handoff"]}
{"args":["close"]}
{"engine":"camoufox","args":["open","https://example.com"]}
```

`handoff` waits until the owner returns control.
`profile: "temporary"` selects an unsaved browser profile when the session starts.
Engine switching does not copy authentication or repeat submissions.
Browser control through Bash is refused so profile ownership and takeover remain coordinated.
CLI help and skill discovery remain available.

Camoufox supports navigation, snapshots, element actions, text extraction, screenshots, uploads, and tabs.
Unsupported commands return an error instead of silently switching engines.
The agent must take fresh snapshots after page changes and check action results.

## Viewing and lifecycle

The first frame opens the preview automatically.
Hide stops frame delivery. Show resumes it.
Expand provides fit, zoom, page address, and sign-in controls.
Android Back and Escape close the viewer.
The inline preview retains the last frame briefly after completion.
An expanded viewer retains it until dismissal.
Frames remain in memory; the preview does not save them to disk.

The workspace owns each browser process and closes it when its run ends, except during owner takeover.
Startup cleans up registered Chromium sessions from an earlier workspace process.
Camoufox workers use pipes and close their browser when their input pipe closes.
Cleanup retries retain profile ownership until the old process closes.
A watchdog closes inactive, abandoned sessions after thirty minutes.

## Transport

Chromium streams JPEG frames through its local agent-browser connection.
Camoufox captures JPEG frames on demand, at most twice per second.
The gateway relays frames through the authenticated workspace connection.
Clients acknowledge frames; each viewer has at most one frame in flight.
Hidden pages disconnect their viewer.

Owner controls use `/api/browser/control` with same-origin JSON requests.
The workspace checks the principal, conversation, session, and takeover state before accepting input.
The frame WebSocket accepts acknowledgements and heartbeats only.
The standalone Browser screen remains a development preview.

## Verification

Backend tests cover ownership, profile queuing, cancellation, takeover, input validation, recovery, and cleanup.
Web tests cover controls, responsive layout, accessibility, navigation, reconnection, and completion.
`scripts/browser-session-smoke.ts` checks both engines with real browser processes.
It checks saved authentication across restarts, owner input, snapshots, and preview frames.
CI runs browser smoke checks on amd64 and arm64.

The optional system flow checks the gateway, workspace, proxy, and Chromium path:

```sh
E2E_BROWSER_EXECUTABLE_PATH=/path/to/chrome bun run e2e:system browser-preview
```
