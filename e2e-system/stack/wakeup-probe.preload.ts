// E2E-only clock control. Never loaded by the production workspace entrypoint.
import { rmSync } from "node:fs";

const socket = process.env["E2E_WAKEUP_SOCKET"];
const baseline = Date.parse(process.env["E2E_WAKEUP_NOW"] ?? "");
if (!socket || !Number.isFinite(baseline)) throw new Error("Wakeup probe configuration is missing");
let now = baseline;

// Dynamic import keeps the harness typecheck separate from the workspace type graph.
const mod = await import(new URL("../../src/workspace/wakeups.ts", import.meta.url).href);
type Manager = { opts: { now?: () => Date }; tick(): Promise<void> };
let captured: Manager | null = null;
const start = mod.WakeupManager.prototype.start;
mod.WakeupManager.prototype.start = function (this: Manager) {
  this.opts.now = () => new Date(now);
  captured = this;
  return start.call(this);
};

rmSync(socket, { force: true });
Bun.serve({
  unix: socket,
  async fetch(req) {
    if (req.method !== "POST" || new URL(req.url).pathname !== "/tick") return new Response("not found", { status: 404 });
    if (!captured) return new Response("wakeups not started", { status: 503 });
    const { at } = await req.json() as { at?: string };
    const next = at === undefined ? baseline : Date.parse(at);
    if (!Number.isFinite(next)) return new Response("invalid clock time", { status: 400 });
    now = next;
    await captured.tick();
    return Response.json({ ok: true });
  },
});
export {};
