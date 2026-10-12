# Connected machines

The machine daemon runs on a PC or file server. It connects out to the bot's orchestration listener at `/machines`. It does not replace the main workspace or open a local server port.

The main agent gets `machine_files`. It can list connected machines, list shared folders, read text files, and search literal text. `task_manage` can start Codex or Claude Code on a connected machine. The task UI offers the same controls.

## Configure the bot

Set `SUSHII_MACHINES_JSON` in the bot environment. Use a separate random token for each machine. Generate one with `openssl rand -hex 32`.

```json
[
  { "id": "pc", "name": "My PC", "token": "<random-machine-token>" },
  { "id": "files", "name": "File server", "token": "<different-random-token>" }
]
```

Expose `/machines` on the existing orchestration listener through your private TLS reverse proxy. Forward WebSocket upgrades, `Authorization`, and `X-Sushii-Machine`. Use `wss://` from remote machines. The daemon accepts plain `ws://` only on loopback for local tests.

These tokens authorize machine connections only. They cannot register the main workspace, call bot tools, or read another machine's session. Do not reuse `ORCH_SECRET`.

## Configure a machine

Install Bun and this repository. Install and sign in to the coding CLIs on machines that will run coding tasks. A file server can omit providers entirely.

Create a private config file, for example `/home/me/.config/sushii/machine.json`:

```json
{
  "id": "pc",
  "name": "My PC",
  "url": "wss://<private-orchestration-host>/machines",
  "token": "<same-token-configured-on-the-bot>",
  "stateDir": "/home/me/.local/state/sushii-machine",
  "roots": [
    { "id": "docs", "name": "File server documents", "path": "/mnt/files/documents", "coding": false },
    { "id": "project", "name": "My project", "path": "/home/me/projects/my-project", "coding": true }
  ],
  "providers": { "codex": ["codex"], "claude": ["claude"] }
}
```

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
ExecStart=/absolute/path/to/bun /absolute/path/to/sushii-agent/src/workspace/machine/index.ts /home/me/.config/sushii/machine.json
WorkingDirectory=/absolute/path/to/sushii-agent
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

## Coding tasks

Create a task first. Choose a machine, coding folder, and provider in its details. Start is separate from saving a to-do. The main agent can also call:

```json
{ "action": "start", "id": "<task-id>", "target": { "machineId": "pc", "rootId": "project", "provider": "codex" } }
```

The task stores its machine, folder, provider, and remote session ID before launch. Repeated initial starts use that ID. A follow-up resumes the provider's own transcript. The daemon records attempts and keeps the latest 64 KB of visible output. Up to four sessions can work at once. Work continues through a bot connection loss; it is marked interrupted after a daemon restart.

Use the task's Conversation tab, or Activity tab in the chat inspector, to read output, answer Codex command/file approvals, send a follow-up, or stop work. A remote attempt finishing leaves the task ready for review. It does not check off the task automatically. Send follow-ups after the current attempt finishes, or stop it first.

Codex uses app-server with a workspace-write sandbox and network access disabled by default. Permission requests require an owner's UI decision. Unsupported interactive requests return a blocker rather than being accepted automatically. Claude Code uses its normal headless CLI permission behavior and does not bypass permissions. A coding root selects the working directory; it is not an operating-system sandbox for Claude. A denied operation may need a change to the machine's own CLI settings.

After a request timeout, check the session before retrying. The daemon does not automatically restart coding work or repeat prompts on reconnect. CLI sign-in remains on the machine. This integration does not promise visibility in the official Codex or Claude mobile apps.

Protocol references: [Codex app-server](https://learn.chatgpt.com/docs/app-server) and [Claude Code programmatic use](https://code.claude.com/docs/en/headless).
