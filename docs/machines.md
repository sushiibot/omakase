# Connected machines

The machine daemon runs on a PC or file server. It connects out to the gateway's orchestration listener at `/machines`. It does not replace the main workspace or open a local server port.

The main agent gets `machine_files`. It can list connected machines, list shared folders, read text files, and search literal text. `coding_agent` starts Codex or Claude Code agents on a connected machine. The conversation that started an agent shows its controls.

## Configure the gateway

Set `SUSHII_MACHINES_JSON` in the gateway environment. Use a separate random token for each machine. Generate one with `openssl rand -hex 32`.

```json
[
  { "id": "pc", "name": "My PC", "token": "<random-machine-token>" },
  { "id": "files", "name": "File server", "token": "<different-random-token>" }
]
```

Expose `/machines` on the existing orchestration listener through your private TLS reverse proxy. Forward WebSocket upgrades, `Authorization`, and `X-Sushii-Machine`. Use `wss://` from remote machines. The daemon accepts plain `ws://` only on loopback for local tests.

These tokens authorize machine connections only. They cannot register the main workspace, call gateway tools, or read another machine's session. Do not reuse `ORCH_SECRET`.

## Configure a machine

Install Bun and this repository. Install and sign in to the coding CLIs on machines that will run agents. A file server can omit providers entirely.

Create a private config file, for example `/home/me/.config/sushii/machine.json`:

```json
{
  "id": "pc",
  "name": "My PC",
  "url": "wss://<private-orchestration-host>/machines",
  "token": "<same-token-configured-on-the-gateway>",
  "stateDir": "/home/me/.local/state/sushii-machine",
  "roots": [
    { "id": "docs", "name": "File server documents", "path": "/mnt/files/documents", "coding": false },
    { "id": "project", "name": "My project", "path": "/home/me/projects/my-project", "coding": true }
  ],
  "providers": { "codex": ["codex"], "claude": ["claude"] },
  "stallMinutes": 10
}
```

`stallMinutes` (default 10) is how long a running session may produce no output before it is reported as stalled.

Use native absolute paths on Windows. A mounted SMB or NFS folder works as a shared root. Each root has its own ID. `coding: false` permits file reads only. `coding: true` also permits launching a coding session with that folder as its working directory.

Protect the config with `chmod 600`. Do not commit it. Start the daemon:

```sh
bun run machine /home/me/.config/sushii/machine.json
```

You can also build a binary with `bun build src/workspace/machine/index.ts --compile --outfile sushii-machine`, then run it with the config path. Run the daemon as a regular user with access to the required folders. Configure your service manager to restart it on failure.

A Linux user service can use this unit:

```ini
[Unit]
Description=Sushii connected machine
After=network-online.target

[Service]
ExecStart=/absolute/path/to/bun /absolute/path/to/omakase/src/workspace/machine/index.ts /home/me/.config/sushii/machine.json
WorkingDirectory=/absolute/path/to/omakase
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Place it in `~/.config/systemd/user/sushii-machine.service`, then run `systemctl --user daemon-reload` and `systemctl --user enable --now sushii-machine`.

## File access

Shared-file operations never write or execute files. Paths are relative to a named share. Absolute paths, traversal outside a share, and symlinks that leave it are rejected. Reads support regular text files in 32 KB pages. Binary files and special files are rejected. Directory listings return up to 200 entries per page.

Search checks the first 32 KB of each regular text file. It skips symlinks, `.git`, and `node_modules`, with limits of 1,000 paths, 4 MB, and 100 matches. Results state these limits; they are not proof that the whole share was searched.

Example agent calls:

```json
{ "action": "list_machines" }
{ "action": "list", "machineId": "files", "rootId": "docs", "path": "." }
{ "action": "read", "machineId": "files", "rootId": "docs", "path": "notes.md", "offset": 0 }
{ "action": "search", "machineId": "files", "rootId": "docs", "query": "renewal" }
```

## Agents

An agent is a Codex or Claude Code session the owner's agent delegates to a coding folder on a machine, for example "a Codex agent on Desktop". Agents are separate from tasks. The main agent manages them with the `coding_agent` tool:

```json
{ "action": "start", "machineId": "pc", "rootId": "project", "provider": "codex", "prompt": "Fix the login redirect and run the tests." }
{ "action": "message", "id": "<agent-id>", "text": "Report what changed and the test results." }
{ "action": "get", "id": "<agent-id>" }
{ "action": "stop", "id": "<agent-id>" }
```

An agent starts only on a daemon that reports agent status; update and restart an older daemon first. A call from outside a web conversation, such as a scheduled job, reports to Main; scheduled jobs cannot start agents. The gateway records each agent, with the conversation that started it, before launch. A repeated start with the same ID is idempotent on the daemon. The daemon keeps the latest 64 KB of visible output. Up to four agents can work at once. Work continues through a gateway connection loss; it is marked interrupted after a daemon restart.

A message reaches an agent in any state. An idle agent resumes its transcript with it. A running Codex turn is steered with it. A running Claude Code turn is interrupted, then resumed with it. An agent waiting on an approval takes no message until the owner answers.

The daemon reports each state change as it happens, and the gateway reconciles every agent when the daemon reconnects. A pending Codex request sends the owner a push notification that leads with the command, host or files to approve, and opens the conversation that started the agent with the approval in view. There, above the composer, are the agent's output, the exact input under review, the agent's own explanation (labelled as such), Approve and Deny, a separate switch to allow matching requests until the turn ends, a message box and Stop. A request that does not say what it would do can only be declined. A finished, failed, interrupted or stalled agent wakes the conversation that started it with the agent's final message. If no workspace can take the result, the owner gets a push notification, and the gateway keeps the result and delivers it once a workspace connects. After three results the main agent followed up on without an owner reply, its coding_agent start and message are refused in that conversation, and the owner is notified, until the owner replies. A stopped agent notifies nobody. The daemon keeps every live agent and the newest 200 finished ones; the gateway forgets agents 30 days after they finish.

Codex uses app-server with a workspace-write sandbox and network access disabled by default. Command, file-change and permission requests take Approve, Approve for this session or Deny. Questions and MCP input requests can only be declined from the app. Other interactive requests return a blocker rather than being accepted automatically. Claude Code uses its normal headless CLI permission behavior and does not bypass permissions: a permission prompt is denied, and the result lists the denied tools. A coding root selects the working directory; it is not an operating-system sandbox for Claude. A denied operation may need a change to the machine's own CLI settings.

After a request timeout, check the session before retrying. The daemon does not automatically restart coding work or repeat prompts on reconnect. CLI sign-in remains on the machine. This integration does not promise visibility in the official Codex or Claude mobile apps.

Protocol references: [Codex app-server](https://learn.chatgpt.com/docs/app-server) and [Claude Code programmatic use](https://code.claude.com/docs/en/headless).
