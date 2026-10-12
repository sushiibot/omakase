# omakase

Owner-only personal agent: a SvelteKit PWA (`web/`), the gateway that serves it (`src/personal.ts`),
and a long-lived workspace container (`src/workspace/`). Split out of sushii-agent.

## Runtime

- **Runtime:** Bun
- **Install:** `bun install`
- **Type check:** `bunx tsc --noEmit`
- **Test:** `OPENAI_API_KEY=dummy bun test`
- **Dev:** `bun dev` (gateway, `./data/personal.db`; `DATABASE_PATH` overrides it)

Never edit, delete or renumber files in `drizzle/`: production databases track those migrations.

## Web app (`web/`)

Owner-only SvelteKit SPA (PWA) served by the gateway on a private network behind a reverse proxy.
Structure and rules: `web/README.md`, `web/docs/ux-guidelines.md`. Gate from `web/`: `bun run check`,
`bun run lint` (prettier + raw-HTML, token and import-boundary checks + unit tests), `bun run build`,
`bun run test:e2e` (ports via `PW_PORT` / `PW_HARNESS_PORT`). Dev with sample data: `bun dev`, then `?fake`.
All live screens are available automatically. Fixture-only screens stay in the development preview until their APIs exist.

## End-to-end system tests (`e2e-system/`)

Real gateway + real workspace + fake model + Traefik-like proxy, driven by Chromium: `bun run e2e:system`
(port slot via `E2E_PORT_BASE`; avoid 5060, Chromium blocks it). One flow per file in `e2e-system/flows/`.

## Deployment

When work is finalized and checks pass, commit and push to `main` without asking for confirmation.

Auto-deploys via CI on every push to `main` (`.github/workflows/ci.yml`): `typecheck`, `test`, `web`,
`web-e2e`, `browser-smoke` and `e2e-system` → `docker-build` (`ghcr.io/sushiibot/omakase:<sha>`) /
`docker-build-workspace` (`:<sha>-workspace`) → `deploy` (gateway) → `deploy-workspace`. No manual
deploy step is needed. Verify with `gh run list --branch main` and the post-deploy logs.
