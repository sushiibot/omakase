# omakase

A self-hosted personal agent with a web app for chat, tasks, voice, and access to your machines.
The agent runs in a persistent workspace with its own files, memory, and scheduled jobs.

Omakase serves one owner on a private network, such as a tailnet.
An authenticated reverse proxy controls access to the app.

## How it works

The app has three parts:

- **Web app** — a SvelteKit PWA with conversations, tasks, notifications, memory, and history.
- **Gateway** — a Bun server that serves the app, stores messages, and connects the browser to the workspace.
- **Workspace** — a long-lived container that runs the Pi coding agent, its tools, and scheduled jobs.

The workspace uses ChatGPT sign-in, with OpenRouter as a fallback.
Its home directory holds files and memory that persist across conversations.
Optional machine daemons give the agent access to files and sessions on your other computers.

## Development

Use Bun. CI currently uses version 1.4.2.

### Preview the web app

```sh
cd web
bun install
bun dev
```

Open `http://localhost:5173/?fake` for sample data without a gateway or model credentials.
See the [web app README](web/README.md) for frontend development and browser tests.

### Run the gateway

From the repository root:

```sh
bun install
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env` to your OpenRouter key.
For local web access, add these values:

```dotenv
WEB_OWNER_LOGIN=owner@localhost
WEB_DEV_LOGIN=owner@localhost
```

Start the gateway:

```sh
bun dev
```

The gateway uses `./data/personal.db` and applies database migrations at startup.
The web development server forwards API requests to the gateway at `http://localhost:8790`.
Open `http://localhost:5173/` without `?fake` to use those APIs.
`WEB_DEV_LOGIN` works only on a loopback address outside production.

Agent replies also require a connected workspace.
Set `DM_WORKSPACE_ENABLED=true` and `ORCH_SECRET` on the gateway.
The workspace uses the same secret and connects through `ORCH_URL` (default: `ws://localhost:8788`).
Its entry point is `bun run workspace`.
The workspace uses `HOME` as its working directory, so run it in a dedicated environment.
The [Dockerfile](Dockerfile) includes a `workspace` target with the agent's tools and runtime dependencies.

## Configuration

[.env.example](.env.example) contains the gateway configuration template.
The main configuration values are:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | OpenRouter key for gateway transcription and workspace model access. Required by both processes. |
| `OPENAI_BASE_URL` | API endpoint. The template uses `https://openrouter.ai/api/v1`. |
| `DATABASE_PATH` | Gateway SQLite database. Defaults to `./data/personal.db`. |
| `WEB_OWNER_LOGIN` | Owner identity. The web gateway stays off without it. |
| `WEB_BIND_ADDR`, `WEB_PORT` | Web listener. Defaults to `127.0.0.1:8790`. |
| `WEB_TRUSTED_PEERS` | Exact proxy IP addresses allowed to supply the `Tailscale-User-Login` identity header. |
| `ORCH_SECRET` | Shared secret for gateway–workspace authentication. |
| `ORCH_PORT`, `ORCH_URL` | Gateway transport port and workspace connection URL. The default port is `8788`. |
| `DM_WORKSPACE_ENABLED` | Routes web chat to the workspace. Defaults to `false`. |

The [gateway configuration](src/config.ts), [web configuration](src/surfaces/web/config.ts), and
[workspace configuration](src/workspace/config.ts) define all variables and defaults.
Optional integrations include web push, GitHub App credentials, Exa, Grafana, Linear, and live voice providers.

## MCP connections

Use **Connectors → Add a server** in the web app to connect a remote MCP server.
Enter its HTTPS address and an API token, or leave the token blank for OAuth sign-in.
Connections support Streamable HTTP and OAuth with dynamic client registration.
Local stdio servers and legacy SSE are not supported.

Connected tools are available in chat, but not scheduled jobs.
A connection authorizes tool use without per-call approval, including new or changed tools from that server.
Use a read-only token to restrict access at the provider.

The workspace stores credentials outside the browser.
Disconnect retains credentials for reconnection. Remove erases them locally but does not revoke the provider token.

## Checks

Run backend checks from the repository root:

```sh
bunx tsc --noEmit
OPENAI_API_KEY=dummy bun test
```

Run frontend checks from `web/`:

```sh
bun run check
bun run lint
bun run build
bun run test:e2e
```

The [system test guide](e2e-system/README.md) covers tests with a real gateway, workspace, browser, and fake model.

## Deployment

The [CI workflow](.github/workflows/ci.yml) runs checks on every push.
Successful pushes to `main` build the gateway and workspace images, then deploy them in that order.
Images use `ghcr.io/sushiibot/omakase:<sha>` and `ghcr.io/sushiibot/omakase:<sha>-workspace`.
The deployment jobs use this repository's configured infrastructure and secrets.

## Further reading

- [Web app](web/README.md)
- [Remote machines](docs/machines.md)
- [Tasks](web/docs/tasks.md)
- [Topic conversations](web/docs/topic-threads.md)
- [Live voice](web/docs/live-voice.md)
- [Browser preview](web/docs/browser-preview.md)
- [UI and UX guidelines](web/docs/ux-guidelines.md)
