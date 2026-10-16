import { z } from "zod";

const relativePath = z.string().min(1).max(2000).refine(p => p === "." || p.split("/").every(s => s && s !== "." && s !== ".." && !s.startsWith(".") && !/[\\\x00-\x1f:]/.test(s)), "Use a relative path without hidden folders or traversal.");
const base = { machineId: z.string().regex(/^phone-[a-f0-9-]{36}$/), rootId: z.literal("vault"), path: relativePath.default(".") };
export const vaultRequest = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("list"), offset: z.number().int().min(0).max(100000).default(0) }).strict(),
  z.object({ ...base, action: z.literal("read") }).strict(),
  z.object({ ...base, action: z.literal("write"), content: z.string().max(262144), expectedHash: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict(),
]);
export type VaultRequest = z.infer<typeof vaultRequest>;
interface Call { id: string; params: VaultRequest; delivered: boolean; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
interface Device { id: string; name: string; session: string; seen: number; pending: Map<string, Call>; wake?: () => void }
/** Owner-authenticated foreground device transport. Never persists or replays writes. */
export class MobileVaults {
  private devices = new Map<string, Device>();
  constructor(private timeoutMs = 25000) {}
  connect(id: string, name: string) {
    this.prune();
    if (!this.devices.has(id) && this.devices.size >= 8) throw new Error("Too many phones connected.");
    const old = this.devices.get(id);
    if (old) this.disconnect(old.session);
    const session = crypto.randomUUID();
    this.devices.set(id, { id, name, session, seen: Date.now(), pending: new Map() });
    return { session };
  }
  private prune() {
    for (const d of this.devices.values()) if (Date.now() - d.seen > 45000) this.disconnect(d.session);
  }
  list() {
    this.prune();
    return [...this.devices.values()].map(d => ({ id: d.id, name: `Android · ${d.name}`, connected: true, roots: [{ id: "vault", name: d.name, coding: false, writable: true }], providers: [] as ("codex" | "claude")[], fileActions: ["list", "read", "write"], readLimit: 262144 }));
  }
  private device(session: string) {
    this.prune();
    const d = [...this.devices.values()].find(d => d.session === session);
    if (!d) throw new Error("Phone session expired. Reconnect the vault.");
    d.seen = Date.now();
    return d;
  }
  async poll(session: string, signal: AbortSignal) {
    const d = this.device(session);
    if (d.wake) throw new Error("A poll is already active.");
    if (signal.aborted) return { requests: [] };
    if (![...d.pending.values()].some(c => !c.delivered)) await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); d.wake = undefined; resolve(); };
      const timer = setTimeout(done, 10000);
      d.wake = done;
      signal.addEventListener("abort", done, { once: true });
    });
    if (signal.aborted) return { requests: [] };
    const requests = [...d.pending.values()].filter(c => !c.delivered);
    for (const c of requests) c.delivered = true;
    return { requests: requests.map(c => ({ id: c.id, params: c.params })) };
  }
  result(session: string, id: string, result: unknown, error?: string) {
    const d = this.device(session);
    const c = d.pending.get(id);
    if (!c || !c.delivered) return;
    clearTimeout(c.timer);
    d.pending.delete(id);
    if (error) c.reject(new Error(error)); else c.resolve(result);
  }
  request(raw: unknown): Promise<unknown> {
    const p = vaultRequest.parse(raw);
    this.prune();
    const d = this.devices.get(p.machineId);
    if (!d) throw new Error("Phone is offline. Open omakase on the phone and connect its vault.");
    if (d.pending.size >= 8) throw new Error("Phone is busy. Retry after the current operation.");
    if (p.action !== "list" && !/\.md$/i.test(p.path)) throw new Error("Only Markdown notes can be read or written.");
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        d.pending.delete(id);
        reject(new Error("Phone request timed out. A write may have completed; read the note before retrying."));
      }, this.timeoutMs);
      d.pending.set(id, { id, params: p, resolve, reject, timer, delivered: false });
      d.wake?.();
    });
  }
  disconnect(session: string) {
    const d = [...this.devices.values()].find(d => d.session === session);
    if (!d) return;
    this.devices.delete(d.id);
    for (const c of d.pending.values()) { clearTimeout(c.timer); c.reject(new Error("Phone disconnected. Read the note before retrying a write.")); }
    d.pending.clear();
    d.wake?.();
  }
  stop() { for (const d of this.devices.values()) this.disconnect(d.session); }
}
