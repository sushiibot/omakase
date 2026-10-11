# sushii-agent

AI agent Discord bot with guild config and OpenRouter.

## Runtime

- **Runtime:** Bun
- **Type check:** `bunx tsc --noEmit`
- **Install:** `bun install`
- **Dev:** `bun dev` (community bot, `./data/sushii-agent.db`), `bun run dev:personal` (personal gateway,
  `./data/personal.db`). `DATABASE_PATH` overrides either.

## Web app (`web/`)

Owner-only SvelteKit SPA (PWA) served by the personal gateway (`src/personal.ts`, its own process and
compose service `private-bots/sushii-agent-personal`, own DB) at agent.sushii.bot (tailnet only). The gateway
also runs the workspace control plane; `src/index.ts` is the community bot only.
Structure and rules: `web/README.md`, `web/docs/ux-guidelines.md`. Gate from `web/`: `bun run check`,
`bun run lint` (prettier + raw-HTML, token and import-boundary checks + unit tests), `bun run build`,
`bun run test:e2e` (ports via `PW_PORT` / `PW_HARNESS_PORT`). Dev with sample data: `bun dev`, then `?fake`.
All live screens are available automatically. Fixture-only screens stay in the development preview until their APIs exist.

## End-to-end system tests (`e2e-system/`)

Real personal gateway + real workspace + fake model + Traefik-like proxy, driven by Chromium: `bun run e2e:system`
(port slot via `E2E_PORT_BASE`; avoid 5060, Chromium blocks it). One flow per file in `e2e-system/flows/`.

## Deployment

When work is finalized and checks pass, commit and push to `main` without asking for confirmation.

Auto-deploys via CI on every push to `main` (`.github/workflows/ci.yml`): `typecheck`, `test`, `web`,
`browser-smoke` and `e2e-system` → `docker-build` / `docker-build-workspace` → `deploy`
(`private-bots/sushii-agent` on host `apps`) → `deploy-personal` (`private-bots/sushii-agent-personal`, same
image, `bun src/personal.ts`) → `deploy-workspace` (`private-bots/sushii-agent-workspace`). No manual `deploy.sh` step is needed — pushing to `main` ships it. Push any
sushii-ansible config change first: the deploy renders from sushii-ansible `main`. Verify with
`gh run list --branch main` and the post-deploy logs.
