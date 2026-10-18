import { chromiumAccountFill, fillAccountPage } from "./accountBrowserFill.ts";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildAgentEnv } from "../agentRuntime/agentEnv.ts";
import type { BrowserEngine, BrowserFrame, BrowserInput } from "../orchestration/browserContracts.ts";

export interface BrowserLaunch { engine: BrowserEngine; profile?: string }
export interface BrowserDriver {
  run(session: string, args: string[], signal?: AbortSignal, launch?: BrowserLaunch): Promise<string>;
  fillAccount?(session: string, input: Parameters<typeof fillAccountPage>[0], signal: AbortSignal | undefined, launch: BrowserLaunch): Promise<void>;
  connect(port: number): WebSocket;
  capture?(session: string): Promise<{ frame: BrowserFrame; url: string }>;
  input?(session: string, input: BrowserInput, launch: BrowserLaunch): Promise<void>;
}

export function browserEnv(session: string, profile?: string): Record<string, string> {
  return { AGENT_BROWSER_SESSION: session, ...(profile ? { AGENT_BROWSER_PROFILE: profile } : {}), AGENT_BROWSER_STREAM_QUALITY: "60", AGENT_BROWSER_STREAM_MAX_WIDTH: "1280", AGENT_BROWSER_STREAM_MAX_HEIGHT: "800", AGENT_BROWSER_MAX_OUTPUT: "32000", AGENT_BROWSER_IDLE_TIMEOUT_MS: "0" };
}

/** One worker per Camoufox session. EOF closes Firefox if the workspace dies. */
class CamoufoxWorker {
  private proc: ReturnType<typeof Bun.spawn>;
  private pending?: { resolve(value: any): void; reject(error: Error): void };
  private dead = false;
  constructor(home: string, profile?: string) {
    this.proc = Bun.spawn([process.env.CAMOUFOX_PYTHON ?? "/opt/camoufox/bin/python", fileURLToPath(new URL("../../scripts/camoufox-worker.py", import.meta.url)), profile ?? ""], {
      cwd: home, env: buildAgentEnv(process.env, { PYTHONUNBUFFERED: "1", HOME: home }), stdin: "pipe", stdout: "pipe", stderr: "ignore",
    });
    void this.read();
  }
  private async read() {
    try {
      let buffer = "";
      const decoder = new TextDecoder();
      for await (const bytes of this.proc.stdout as ReadableStream<Uint8Array>) {
        buffer += decoder.decode(bytes, { stream: true });
        if (buffer.length > 2_000_000) throw new Error("Camoufox response too large");
        let end;
        while ((end = buffer.indexOf("\n")) !== -1) {
          const value = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
          const pending = this.pending; this.pending = undefined;
          if (value.ok) pending?.resolve(value.result);
          else pending?.reject(new Error(value.error ?? "Camoufox command failed"));
        }
      }
    } catch { /* Report a fixed error, never worker output that could contain credentials. */ }
    this.proc.kill();
    this.dead = true;
    this.pending?.reject(new Error("Camoufox stopped. Close this browser session and reopen it.")); this.pending = undefined;
  }
  async request(payload: unknown, signal?: AbortSignal): Promise<any> {
    if (this.dead) throw new Error("Camoufox stopped. Close this browser session and reopen it.");
    if (this.pending) throw new Error("Camoufox command already running");
    const abort = () => this.proc.kill();
    if (signal?.aborted) throw new Error("Browser command cancelled");
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 120_000);
    try {
      return await new Promise((resolve, reject) => {
        this.pending = { resolve, reject };
        (this.proc.stdin as import("bun").FileSink).write(JSON.stringify(payload) + "\n");
      });
    } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
  }
  async close() {
    if (!this.dead) {
      try { await this.request({ args: ["close"] }); }
      finally { (this.proc.stdin as import("bun").FileSink).end(); this.proc.kill(); await this.proc.exited; }
    }
  }
}

export function localBrowserDriver(home: string): BrowserDriver {
  const workers = new Map<string, CamoufoxWorker>();
  const run: BrowserDriver["run"] = async (session, args, signal, launch = { engine: "chromium" }) => {
    if (launch.profile) mkdirSync(launch.profile, { recursive: true, mode: 0o700 });
    if (launch.engine === "camoufox") {
      if (args[0] === "close") { await workers.get(session)?.close(); workers.delete(session); return "Browser closed; saved logins retained."; }
      let worker = workers.get(session);
      if (!worker) { worker = new CamoufoxWorker(home, launch.profile); workers.set(session, worker); }
      const value = await worker.request({ args }, signal);
      return (typeof value === "string" ? value : JSON.stringify(value)).slice(0, 32_000);
    }
    const env = buildAgentEnv(process.env, browserEnv(session, launch.profile));
    for (const key of ["AGENT_BROWSER_STREAM_PORT", "AGENT_BROWSER_CDP", "AGENT_BROWSER_AUTO_CONNECT", "AGENT_BROWSER_PROVIDER", "AGENT_BROWSER_NAMESPACE", "AGENT_BROWSER_STATE", "AGENT_BROWSER_RESTORE", "AGENT_BROWSER_SESSION_NAME", "AGENT_BROWSER_RESTORE_SAVE"]) delete env[key];
    if (!launch.profile) delete env.AGENT_BROWSER_PROFILE;
    const proc = Bun.spawn(["agent-browser", "--session", session, ...args], { cwd: home, env, stdout: "pipe", stderr: "pipe" });
    const abort = () => proc.kill();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 120_000);
    if (signal?.aborted) abort();
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      if (code !== 0 || signal?.aborted) throw new Error(signal?.aborted ? "Browser command cancelled" : (stderr || stdout || "Browser command failed").slice(0, 2000));
      return stdout.slice(0, 32_000);
    } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
  };
  return {
    run,
    async fillAccount(session, input, signal, launch) {
      try {
        if (launch.engine === "camoufox") {
          const worker = workers.get(session);
          if (!worker) throw new Error();
          await worker.request({ accountFill: input, script: fillAccountPage.toString() }, signal);
          return;
        }
        const marker = `__account_fill_${crypto.randomUUID().replaceAll("-", "")}`;
        // Marker and endpoint contain no credentials; only the private CDP request carries them.
        await run(session, ["eval", `globalThis[${JSON.stringify(marker)}] = true; true`], signal, launch);
        try {
          const endpoint = await run(session, ["get", "cdp-url"], signal, launch);
          await chromiumAccountFill(endpoint, marker, input, signal);
        } finally {
          await run(session, ["eval", `delete globalThis[${JSON.stringify(marker)}]; true`], signal, launch).catch(() => {});
        }
      } catch { throw new Error("Account fill failed."); }
    },
    connect: (port) => new WebSocket(`ws://127.0.0.1:${port}/?pacing=ack&maxFps=15`),
    async capture(session) {
      const worker = workers.get(session);
      if (!worker) throw new Error("Camoufox unavailable");
      return worker.request({ capture: true });
    },
    async input(session, input, launch) {
      if (launch.engine === "camoufox") { await workers.get(session)?.request({ input }); return; }
      if (input.kind === "click") {
        await run(session, ["mouse", "move", String(input.x), String(input.y)], undefined, launch);
        await run(session, ["mouse", "down", "left"], undefined, launch);
        await run(session, ["mouse", "up", "left"], undefined, launch);
      } else if (input.kind === "text") await run(session, ["keyboard", "inserttext", input.text], undefined, launch);
      else if (input.kind === "key") await run(session, ["press", input.key], undefined, launch);
      else await run(session, ["scroll", input.direction, "500"], undefined, launch);
    },
  };
}
