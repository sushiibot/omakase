// Entry point for `bun run e2e:system`. Runs the stack natively (run.ts) when the loopback aliases route,
// as on Linux and CI. Otherwise (macOS without aliases) it runs the same run.ts in a Linux container, if a
// Docker engine is up. E2E_DOCKER=1 always uses Docker; E2E_DOCKER=0 never does.
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmdirSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stackConfig } from "./stack/config.ts";

const HERE = import.meta.dir;
const REPO = resolve(HERE, "..");
const args = process.argv.slice(2);
const mode = process.env["E2E_DOCKER"]?.trim();

function run(cmd: string, argv: string[], opts: { cwd?: string; quiet?: boolean } = {}): Promise<number> {
  return new Promise((res) => {
    const child = spawn(cmd, argv, { cwd: opts.cwd ?? REPO, stdio: opts.quiet ? "ignore" : "inherit" });
    child.once("error", () => res(127));
    child.once("exit", (code, sig) => res(code ?? (sig ? 1 : 0)));
  });
}

/** True when a socket bound to `local` reaches a listener on `host` and is seen as `local`. */
async function routes(local: string, host: string): Promise<boolean> {
  const srv = net.createServer();
  try {
    const seen = new Promise<string>((res) => srv.once("connection", (s) => { res(s.remoteAddress ?? ""); s.destroy(); }));
    await new Promise<void>((res, rej) => srv.once("error", rej).listen(0, host, () => res()));
    const port = (srv.address() as net.AddressInfo).port;
    await new Promise<void>((res, rej) => {
      const c = net.connect({ host, port, localAddress: local }, () => { c.destroy(); res(); });
      c.once("error", rej);
    });
    return (await seen) === local;
  } catch {
    return false;
  } finally {
    srv.close();
  }
}

async function aliasesRoute(): Promise<boolean> {
  const { addrs } = stackConfig();
  return (await routes(addrs.trustedPeer, addrs.gateway)) && (await routes(addrs.untrusted, addrs.gateway));
}

/** The repo's pins: Playwright from e2e-system/package.json, Bun from the CI workflow. */
function versions(): { playwright: string; bun: string } {
  const pkg = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")) as { devDependencies: Record<string, string> };
  const playwright = pkg.devDependencies["@playwright/test"]!.replace(/^[^\d]*/, "");
  const bun = /bun-version:\s*([\d.]+)/.exec(readFileSync(join(REPO, ".github", "workflows", "ci.yml"), "utf8"))?.[1];
  if (!bun) throw new Error("no bun-version in .github/workflows/ci.yml");
  return { playwright, bun };
}

async function viaDocker(): Promise<number> {
  const v = versions();
  const image = `omakase-e2e:pw${v.playwright}-bun${v.bun}`;
  console.log(`[e2e] running in Docker (${image})`);
  const built = await run("docker", ["build", "-q", "--load", "-t", image, "--build-arg", `PLAYWRIGHT_VERSION=${v.playwright}`, "--build-arg", `BUN_VERSION=${v.bun}`, HERE]);
  if (built !== 0) return built;

  // Host-visible logs and traces; run.ts deletes its own subdirectory after a green run.
  const hostTmp = join(tmpdir(), `sushii-e2e-docker-${Date.now()}`);
  mkdirSync(hostTmp, { recursive: true });
  const pass = Object.entries(process.env)
    .filter(([k, v]) => v !== undefined && /^(E2E_\w+|PW_\w+|CI)$/.test(k) && !["E2E_DOCKER", "E2E_TMP_DIR"].includes(k))
    .flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  // node_modules stay in volumes: several packages ship per-platform binaries, and the host's are macOS builds.
  const volumes = [
    `${REPO}:/repo`,
    "omakase-e2e-nm-root:/repo/node_modules",
    "omakase-e2e-nm-web:/repo/web/node_modules",
    "omakase-e2e-nm-system:/repo/e2e-system/node_modules",
    "omakase-e2e-bun-cache:/root/.bun/install/cache",
    `${hostTmp}:/e2e-tmp`,
  ].flatMap((v) => ["-v", v]);
  const install = "bun install --frozen-lockfile && (cd web && bun install --frozen-lockfile) && (cd e2e-system && bun install --frozen-lockfile)";
  const script = `${install} >/dev/null && exec bun --no-env-file e2e-system/run.ts "$@"`;
  const code = await run("docker", [
    "run", "--rm", "--init", "--ipc=host",
    ...(process.stdout.isTTY ? ["-t"] : []),
    ...volumes, ...pass, "-e", "E2E_TMP_DIR=/e2e-tmp/run",
    image, "bash", "-c", script, "e2e", ...args,
  ]);
  if (readdirSync(hostTmp).length === 0) rmdirSync(hostTmp);
  else console.log(`[e2e] logs and traces: ${join(hostTmp, "run")}`);
  return code;
}

async function main(): Promise<number> {
  const native = () => run(process.execPath, ["--no-env-file", join(HERE, "run.ts"), ...args]);
  if (mode === "1") return viaDocker();
  if (mode === "0" || (await aliasesRoute())) return native();
  if ((await run("docker", ["info"], { quiet: true })) === 0) {
    console.log("[e2e] 127.0.0.2/.3/.5 don't route to loopback here, so the stack runs in Docker");
    return viaDocker();
  }
  const { addrs } = stackConfig();
  console.error(
    `[e2e] ${addrs.gateway}, ${addrs.trustedPeer} and ${addrs.untrusted} don't route to loopback, and no Docker engine is running. Either start one ` +
      `(Docker Desktop, OrbStack or colima), or add the aliases: sudo ifconfig lo0 alias ${addrs.gateway} && ` +
      `sudo ifconfig lo0 alias ${addrs.trustedPeer} && sudo ifconfig lo0 alias ${addrs.untrusted}`,
  );
  return 1;
}

process.exit(await main());
