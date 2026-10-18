import { accountFill, type AccountFill, type AccountsClient } from "./accounts.ts";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { BROWSER_READ, BROWSER_CONTROL, browserControlParams, type BrowserControlRequest, type BrowserEngine, browserReadParams, browserFrame, type BrowserFrame, type BrowserReadResult, type BrowserStatus } from "../orchestration/browserContracts.ts";
import { getLogger } from "../logger.ts";

const log = getLogger("workspace.browser");
const SESSION_RE = /^sushii-[a-f0-9-]{36}$/;
const ACTIONS = new Set(["open", "snapshot", "click", "dblclick", "fill", "type", "press", "scroll", "select", "check", "uncheck", "hover", "get", "is", "find", "wait", "screenshot", "tab", "back", "forward", "reload", "eval", "download", "dialog", "read", "upload", "handoff", "close"]);
const LABELS: Record<string, string> = { open: "Opening page", click: "Clicking", dblclick: "Clicking", fill: "Filling a field", type: "Typing", press: "Pressing a key", scroll: "Scrolling", screenshot: "Taking a screenshot", snapshot: "Reading page", get: "Reading page", read: "Reading page", wait: "Waiting for page", close: "Closing browser" };

export { localBrowserDriver, type BrowserDriver } from "./browserDriver.ts";
import { browserEnv, type BrowserDriver, type BrowserLaunch } from "./browserDriver.ts";

interface Entry {
  status: BrowserStatus;
  session: string;
  ready: boolean;
  socket?: WebSocket;
  frame?: BrowserFrame;
  viewedAt: number;
  busy: number;
  touchedAt: number;
  launch: BrowserLaunch;
  serial: Promise<unknown>;
  acquired: boolean;
  settled: boolean;
  captureAt: number;
  capturing: boolean;
}

/** Processes and frames belong to a run, never to a viewer. Frames stay in memory only. */
export class BrowserManager {
  private readonly entries = new Map<string, Entry>();
  private readonly owned = new Map<string, BrowserLaunch>();
  private readonly profiles = new Map<string, string>();
  private readonly file: string;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly closing = new Map<string, Promise<void>>();
  constructor(private readonly stateDir: string, private readonly driver: BrowserDriver, private readonly now = Date.now, private readonly accounts?: AccountsClient) {
    this.file = join(stateDir, "browser-sessions.json");
    this.timer = setInterval(() => void this.sweep(), 1000);
    this.timer.unref();
  }

  async recover() {
    try {
      const names: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      if (Array.isArray(names)) for (const item of names) {
        const name = typeof item === "string" ? item : item?.session;
        const engine = typeof item === "string" ? "chromium" : item?.engine;
        if (typeof name === "string" && SESSION_RE.test(name) && ["chromium", "camoufox"].includes(engine)) this.owned.set(name, { engine });
      }
    } catch {}
    for (const session of [...this.owned.keys()]) await this.closeOwned(session);
  }

  private persist() {
    mkdirSync(this.stateDir, { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify([...this.owned].map(([session, launch]) => ({ session, engine: launch.engine }))), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }

  private closeOwned(session: string): Promise<void> {
    const previous = this.closing.get(session);
    if (previous) return previous;
    const close = (async () => {
      try {
        await this.driver.run(session, ["close"], undefined, this.owned.get(session));
        for (const [profile, owner] of this.profiles) if (owner === session) this.profiles.delete(profile);
        this.owned.delete(session);
        this.persist();
      } catch { log.warn({ session }, "browser cleanup will retry"); }
      finally { this.closing.delete(session); }
    })();
    this.closing.set(session, close);
    return close;
  }

  bind(conversationId: string, runId: () => string | null): BrowserBinding {
    return new BrowserBinding(this, conversationId, runId);
  }

  create(conversationId: string, runId: string | null, engine: BrowserEngine = "chromium", profile: "owner" | "temporary" = "owner"): Entry {
    const session = `sushii-${randomUUID()}`;
    const launch: BrowserLaunch = { engine, ...(profile === "owner" ? { profile: join(this.stateDir, "browser-profiles", engine) } : {}) };
    const entry: Entry = { session, launch, serial: Promise.resolve(), acquired: false, settled: false, captureAt: 0, capturing: false, ready: false, status: { id: session, conversationId, runId, engine, profile, control: "agent", state: "starting", action: "Opening browser" }, viewedAt: 0, busy: 0, touchedAt: this.now() };
    this.owned.set(session, launch);
    this.persist(); // Record ownership before the daemon starts, including failures and crashes.
    this.entries.set(session, entry);
    return entry;
  }

  private async available(entry: Entry, signal?: AbortSignal) {
    const deadline = Date.now() + 120_000;
    while (entry.launch.profile && this.profiles.has(entry.launch.profile) && this.profiles.get(entry.launch.profile) !== entry.session) {
      entry.status.action = "Waiting for saved browser profile";
      if (signal?.aborted || entry.status.state === "ended") throw new Error("Browser command cancelled");
      if (Date.now() > deadline) throw new Error("Saved browser profile is busy. Close this session and use profile: temporary for independent research, or retry later.");
      await Bun.sleep(100);
    }
    if (signal?.aborted || entry.status.state === "ended") throw new Error("Browser command cancelled");
    if (entry.launch.profile) this.profiles.set(entry.launch.profile, entry.session);
    entry.acquired = true;
  }

  private async serial<T>(entry: Entry, task: () => Promise<T>): Promise<T> {
    const next = entry.serial.catch(() => {}).then(task);
    entry.serial = next;
    return next;
  }

  async prepare(entry: Entry, signal?: AbortSignal) {
    if (entry.ready) return;
    await this.available(entry, signal);
    await this.driver.run(entry.session, ["open", "about:blank"], signal, entry.launch);
    if (entry.launch.engine === "chromium") await this.driver.run(entry.session, ["set", "viewport", "1280", "800"], signal, entry.launch);
    if (entry.status.endedAt) throw new Error("Browser command cancelled");
    entry.ready = true;
    entry.status.state = "active";
  }

  private async waitForOwner(entry: Entry, signal?: AbortSignal) {
    while (entry.status.control === "owner" && entry.status.state !== "ended") {
      if (signal?.aborted) throw new Error("Browser command cancelled");
      await Bun.sleep(100);
    }
    if (signal?.aborted || entry.status.state === "ended") throw new Error("Browser command cancelled");
  }

  async execute(entry: Entry, args: string[], signal?: AbortSignal) {
    if (args[0] === "close") { await this.waitForOwner(entry, signal); await this.finish(entry, true); return "Browser closed; saved logins retained."; }
    entry.busy++;
    entry.touchedAt = this.now();
    try {
      await this.waitForOwner(entry, signal);
      await this.serial(entry, () => this.prepare(entry, signal));
      if (args[0] === "handoff") {
        await this.control({ conversationId: entry.status.conversationId, id: entry.session, action: "takeover" });
        await this.waitForOwner(entry, signal);
        return "Owner returned control. Take a fresh snapshot before continuing.";
      }
      // A takeover can arrive while a command is queued. Recheck after acquiring the queue.
      for (;;) {
        await this.waitForOwner(entry, signal);
        const result = await this.serial(entry, async () => {
          if (entry.status.control === "owner") return undefined;
          if (entry.status.state === "ended" || signal?.aborted) throw new Error("Browser command cancelled");
          entry.status.action = LABELS[args[0]!] ?? "Using browser";
          return this.driver.run(entry.session, args, signal, entry.launch);
        });
        if (result !== undefined) return result;
      }
    } finally { entry.busy--; entry.touchedAt = this.now(); }
  }

  async fillAccount(entry: Entry, input: AccountFill, signal?: AbortSignal): Promise<string> {
    if (!this.accounts || !this.driver.fillAccount) throw new Error("Account fill unavailable.");
    entry.busy++;
    entry.touchedAt = this.now();
    try {
      await this.waitForOwner(entry, signal);
      return await this.serial(entry, async () => {
        if (entry.status.control === "owner" || entry.status.state === "ended" || signal?.aborted) throw new Error("Account fill cancelled.");
        await this.prepare(entry, signal);
        let receiptId: string | undefined;
        try {
          const url = new URL((await this.driver.run(entry.session, ["get", "url"], signal, entry.launch)).trim());
          if (url.protocol !== "https:" || url.username || url.password) throw new Error();
          const secret = await this.accounts!.fill(input, url.origin, entry.launch.engine, entry.status.runId ?? undefined);
          receiptId = secret.receiptId;
          if (entry.status.control === "owner" || entry.status.state === "ended" || signal?.aborted) throw new Error();
          await this.driver.fillAccount!(entry.session, { origin: url.origin, fields: input.fields, password: secret.password, username: secret.username }, signal, entry.launch);
          await this.accounts!.result(receiptId, "filled");
          receiptId = undefined;
          return "Account fields filled. Verify the page before submitting; credentials have not been confirmed.";
        } catch {
          if (receiptId) await this.accounts!.result(receiptId, "failed").catch(() => {});
          throw new Error("Account fill failed. Check the page and account origin before retrying.");
        }
      });
    } finally { entry.busy--; entry.touchedAt = this.now(); }
  }

  async finish(entry: Entry, force = false) {
    entry.settled = true;
    if (entry.status.state === "ended") return;
    if (entry.status.control === "owner" && !force) return; // Keep a sign-in open until the owner returns control.
    entry.status = { ...entry.status, state: "ended", action: "Finished", endedAt: this.now() };
    entry.socket?.close(); entry.socket = undefined;
    await this.serial(entry, async () => {
      if (entry.acquired) await this.closeOwned(entry.session);
      else { this.owned.delete(entry.session); this.persist(); }
    });
  }

  async control(q: BrowserControlRequest): Promise<BrowserReadResult> {
    const entry = this.entries.get(q.id);
    if (!entry || entry.status.conversationId !== q.conversationId || entry.status.state === "ended" || !entry.ready) throw new Error("Browser session unavailable");
    entry.touchedAt = this.now();
    if (q.action === "takeover") {
      entry.status.control = "owner"; // Stop new agent commands before waiting for an in-flight action.
      entry.status.action = "You control the browser";
      await entry.serial.catch(() => {});
    } else if (q.action === "resume") {
      await entry.serial.catch(() => {});
      entry.status.control = "agent";
      entry.status.action = "Control returned to agent";
      if (entry.settled) await this.finish(entry, true);
    } else {
      await this.serial(entry, async () => {
        if (entry.status.control !== "owner" || entry.status.state === "ended") throw new Error("Take control before sending browser input");
        if (!this.driver.input) throw new Error("Browser input unavailable");
        try { await this.driver.input(entry.session, q.input!, entry.launch); }
        catch { throw new Error("Browser input failed. Refresh the preview and try again."); }
      });
    }
    return { status: { ...entry.status } };
  }

  async read(conversationId: string, frames: boolean): Promise<BrowserReadResult> {
    const matching = [...this.entries.values()].filter((e) => e.status.conversationId === conversationId).reverse();
    const entry = matching.find((e) => e.status.control === "owner" && e.status.state !== "ended") ?? matching.find((e) => e.status.state !== "ended" && e.ready) ?? matching.find((e) => e.status.state !== "ended") ?? matching[0];
    if (!entry) return { status: null };
    if (frames && entry.status.state !== "ended" && entry.ready) {
      entry.viewedAt = this.now();
      if (entry.launch.engine === "camoufox") {
        if (!entry.capturing && this.now() - entry.captureAt > 500 && this.driver.capture) {
          entry.capturing = true; entry.captureAt = this.now();
          void this.serial(entry, async () => {
            if (entry.status.state === "ended") return;
            const result = await this.driver.capture!(entry.session);
            const frame = browserFrame.parse(result.frame);
            if (!entry.status.endedAt) { entry.frame = frame; entry.status.url = result.url; }
          }).catch(() => {}).finally(() => { entry.capturing = false; });
        }
      } else if (!entry.socket) await this.stream(entry);
      if (entry.socket?.readyState === WebSocket.OPEN && entry.frame) entry.socket.send(JSON.stringify({ type: "ack", seq: entry.frame.seq }));
    }
    return { status: { ...entry.status }, ...(frames && entry.frame ? { frame: entry.frame } : {}) };
  }

  private connecting = new Set<string>();
  private async stream(entry: Entry) {
    if (this.connecting.has(entry.session)) return;
    this.connecting.add(entry.session);
    try {
      const raw = JSON.parse(await this.driver.run(entry.session, ["stream", "status", "--json"], undefined, entry.launch));
      const port = raw.data?.port ?? raw.port;
      if (!Number.isInteger(port) || port < 1 || port > 65535 || entry.status.state === "ended") return;
      const socket = this.driver.connect(port);
      entry.socket = socket;
      socket.onmessage = (event) => {
        if (entry.socket !== socket || typeof event.data !== "string" || event.data.length > 600_000) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "url" && typeof msg.url === "string" && msg.url.length <= 4096) entry.status.url = msg.url;
          if (msg.type === "tabs" && Array.isArray(msg.tabs)) {
            const url = msg.tabs.find((t: { active?: boolean }) => t.active)?.url;
            if (typeof url === "string" && url.length <= 4096) entry.status.url = url;
          }
          if (msg.type === "command" && typeof msg.action === "string") entry.status.action = entry.status.control === "owner" ? "You control the browser" : LABELS[msg.action] ?? "Using browser";
          if (msg.type === "frame") {
            const frame = browserFrame.safeParse({ seq: msg.seq, data: msg.data, width: msg.metadata?.deviceWidth, height: msg.metadata?.deviceHeight, capturedAt: msg.metadata?.timestamp });
            if (frame.success) { entry.frame = frame.data; entry.status.state = "active"; }
            else socket.close();
          }
        } catch { socket.close(); }
      };
      socket.onclose = socket.onerror = () => { if (entry.socket === socket) entry.socket = undefined; };
    } catch { /* A daemon starting or restarting is retried on the next read. */ }
    finally { this.connecting.delete(entry.session); }
  }

  private async sweep() {
    for (const [conversation, entry] of this.entries) {
      if (entry.socket && this.now() - entry.viewedAt > 2000) { entry.socket.close(); entry.socket = undefined; }
      // Runs can wait indefinitely on an owner approval. Only abandoned bindings expire.
      if (!entry.busy && entry.status.state !== "ended" && this.now() - entry.touchedAt > 30 * 60_000) await this.finish(entry, true);
      if (entry.status.endedAt && this.now() - entry.status.endedAt > 60_000) this.entries.delete(conversation);
    }
    const active = new Set([...this.entries.values()].filter((e) => e.status.state !== "ended").map((e) => e.session));
    for (const session of this.owned.keys()) if (!active.has(session)) await this.closeOwned(session);
  }

  handlers(principalId: string) {
    return { [BROWSER_READ]: async (p: unknown) => {
      const q = browserReadParams.parse(p);
      if (q.principalId !== principalId) throw new Error("principal mismatch");
      return this.read(q.conversationId, q.frames);
    }, [BROWSER_CONTROL]: async (p: unknown) => {
      const q = browserControlParams.parse(p);
      if (q.principalId !== principalId) throw new Error("principal mismatch");
      return this.control(q.request);
    } };
  }

  async dispose() {
    clearInterval(this.timer);
    await Promise.all([...this.entries.values()].map((e) => this.finish(e, true)));
    for (const session of [...this.owned.keys()]) await this.closeOwned(session);
  }
}

export class BrowserBinding {
  private entry?: Entry;
  private closing: Promise<void> = Promise.resolve();
  constructor(private readonly manager: BrowserManager, private readonly conversationId: string, private readonly runId: () => string | null) {}
  async begin(engine?: BrowserEngine, profile?: "owner" | "temporary") {
    await this.closing;
    if (!this.entry || this.entry.status.state === "ended" || this.entry.settled) this.entry = this.manager.create(this.conversationId, this.runId(), engine, profile);
    else if ((engine && engine !== this.entry.launch.engine) || (profile && profile !== this.entry.status.profile)) throw new Error("Close the current browser before changing engine or profile. Logins are separate between engines.");
    return this.entry;
  }
  touch() { if (this.entry) this.entry.touchedAt = Date.now(); }
  finish() {
    const entry = this.entry;
    if (entry) this.closing = this.closing.then(() => this.manager.finish(entry));
    return this.closing;
  }
  wrapBash(tool: ToolDefinition): ToolDefinition {
    const execute = tool.execute.bind(tool);
    return { ...tool, execute: async (id, params, signal, onUpdate, ctx) => {
      const command = (params as { command?: string }).command ?? "";
      if (/\b(?:agent-browser|camoufox-cli)\b/.test(command) && !/^\s*(?:agent-browser|camoufox-cli)\s+(?:skills|--help|--version)\b[^;&|]*$/.test(command)) throw new Error("Use the browser tool for managed sessions, saved logins, and owner takeover.");
      return execute(id, params, signal, onUpdate, ctx);
    } } as ToolDefinition;
  }
  env(): Record<string, string> { return this.entry ? browserEnv(this.entry.session, this.entry.launch.profile) : {}; }
  tool(): ToolDefinition {
    return {
      name: "browser", label: "Browser",
      description: "Managed browser with saved logins and owner preview. Chromium is default; use engine camoufox as a fallback, closing the old session first. Profiles are separate per engine. profile owner saves logins and queues access; use temporary for parallel anonymous research. Pass commands: open URL, snapshot -i, click @e3, fill @e3 text, press Enter, scroll down, get text body, tab, screenshot path, upload selector path. handoff pauses until the owner finishes sign-in in the preview. Take fresh snapshots after changes and verify outcomes. Never retry a submission automatically across engines. close stops the browser but retains saved logins. Use this tool, not Bash, for browser control. To fill stored credentials, use args [fill-account], accountId, optional version, and fields {password, confirmPassword?, username?} containing unique CSS selectors (not @refs). Only password-type inputs accept passwords. This never submits or confirms an account.",
      promptSnippet: "browser: managed Chromium/Camoufox, saved logins, owner sign-in handoff; use temporary profiles for parallel research",
      parameters: Type.Object({ accountId: Type.Optional(Type.String()), version: Type.Optional(Type.Number()), fields: Type.Optional(Type.Object({ password: Type.String(), confirmPassword: Type.Optional(Type.String()), username: Type.Optional(Type.String()) })), args: Type.Array(Type.String({ maxLength: 16000 }), { minItems: 1, maxItems: 32 }), engine: Type.Optional(Type.Union([Type.Literal("chromium"), Type.Literal("camoufox")])), profile: Type.Optional(Type.Union([Type.Literal("owner"), Type.Literal("temporary")])) }) as ToolDefinition["parameters"],
      execute: async (_id: string, params: unknown, signal?: AbortSignal) => {
        const { args, engine, profile, accountId, version, fields } = params as { accountId?: string; version?: number; fields?: AccountFill["fields"]; args: string[]; engine?: BrowserEngine; profile?: "owner" | "temporary" };
        if (engine && !["chromium", "camoufox"].includes(engine) || profile && !["owner", "temporary"].includes(profile)) throw new Error("Invalid browser engine or profile");
        if (Array.isArray(args) && args[0] === "fill-account") {
          if (args.length !== 1) throw new Error("Account fill takes selectors in fields, never credential values.");
          const parsed = accountFill.safeParse({ accountId, version, fields });
          if (!parsed.success) throw new Error("Invalid account fill fields.");
          const text = await this.manager.fillAccount(await this.begin(engine, profile), parsed.data, signal);
          return { content: [{ type: "text", text }], details: {} };
        }
        if (accountId !== undefined || fields !== undefined || version !== undefined) throw new Error("Use fill-account for account credentials.");
        if (!Array.isArray(args) || !ACTIONS.has(args[0]!) || args.some((a) => /^--(?:session|namespace|cdp|auto-connect|provider|all|config|executable-path|profile|persistent|state|restore|proxy|extension|args|headed|session-name)(?:=|$)/.test(a))) throw new Error("Use a browser action in the managed local session.");
        const entry = await this.begin(engine, profile);
        const text = await this.manager.execute(entry, args, signal);
        return { content: [{ type: "text", text }], details: {} };
      },
    } as ToolDefinition;
  }
}
