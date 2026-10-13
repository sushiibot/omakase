import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  machineId,
  machineInfo,
  sessionSummary,
  MACHINE_SESSIONS,
  MACHINE_SESSION_CHANGED,
  SESSION_EVENTS_FEATURE,
  type SessionSummary,
} from "./contracts.ts";
export const machineGrants = z
  .array(
    z
      .object({
        id: machineId,
        name: z.string().min(1).max(100),
        token: z.string().min(32).max(256),
      })
      .strict(),
  )
  .max(32);
export type MachineGrant = z.infer<typeof machineGrants>[number];
export interface MachineSocket {
  send(data: string): unknown;
  close(code?: number, reason?: string): unknown;
}
interface Peer {
  socket: MachineSocket;
  info?: z.infer<typeof machineInfo>;
  /** The daemon answered the session snapshot, so it reports changes and accepts newer session actions. */
  events?: boolean;
  pending: Map<
    number,
    {
      resolve(v: unknown): void;
      reject(e: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >;
}
export type SessionListener = (
  machineId: string,
  summary: SessionSummary,
) => void;
export class MachineHub {
  private peers = new Map<string, Peer>();
  private nextId = 1;
  private onSession: SessionListener = () => {};
  snapshotRetryMs = 1000;
  /** Receives every session change a daemon reports, live or from its snapshot on connect. */
  setSessionListener(listener: SessionListener) {
    this.onSession = listener;
  }
  constructor(readonly grants: MachineGrant[]) {
    if (
      new Set(grants.map((g) => g.id)).size !== grants.length ||
      new Set(grants.map((g) => g.token)).size !== grants.length
    )
      throw new Error("Each machine needs a unique ID and token.");
  }
  authorize(req: Request): string | null {
    const id = req.headers.get("X-Sushii-Machine");
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return null;
    const token = auth.slice(7);
    const grant = this.grants.find((g) => g.id === id);
    if (!grant) return null;
    const a = Buffer.from(token);
    const b = Buffer.from(grant.token);
    return a.length === b.length && timingSafeEqual(a, b) ? grant.id : null;
  }
  open(id: string, socket: MachineSocket) {
    const previous = this.peers.get(id);
    const peer: Peer = { socket, pending: new Map() };
    this.peers.set(id, peer);
    if (previous) {
      this.reject(previous);
      previous.socket.close(4003, "Machine reconnected");
    }
    void this.request(id, "machine/info", {
      features: [SESSION_EVENTS_FEATURE],
    })
      .then((info) => {
        if (this.peers.get(id) !== peer) return false;
        peer.info = machineInfo.parse(info);
        return true;
      })
      .catch(() => {
        socket.close(1008, "Invalid machine information");
        return false;
      })
      .then((ok) => (ok ? this.snapshot(id, peer) : undefined));
  }
  /** Events between connections were missed, so every session is reconciled against its latest state. */
  private async snapshot(id: string, peer: Peer) {
    let raw: unknown;
    for (let attempt = 0; ; attempt++) {
      try {
        raw = await this.request(id, MACHINE_SESSIONS, {});
        break;
      } catch (err) {
        // An older daemon has no snapshot; anything else (busy, timeout) is retried with backoff.
        if (
          this.peers.get(id) !== peer ||
          attempt >= 5 ||
          (err instanceof Error && err.message === "Unknown machine operation.")
        )
          return;
        await Bun.sleep(this.snapshotRetryMs * 2 ** attempt);
      }
    }
    if (this.peers.get(id) !== peer || !Array.isArray(raw)) return;
    peer.events = true;
    for (const item of raw.slice(0, 1000)) {
      const summary = sessionSummary.safeParse(item);
      if (summary.success) this.emit(id, summary.data);
    }
  }
  private emit(id: string, summary: SessionSummary) {
    try {
      this.onSession(id, summary);
    } catch {
      /* A listener failure must not drop the machine connection. */
    }
  }
  close(id: string, socket: MachineSocket) {
    const peer = this.peers.get(id);
    if (peer?.socket !== socket) return;
    this.peers.delete(id);
    this.reject(peer);
  }
  private reject(peer: Peer) {
    for (const call of peer.pending.values()) {
      clearTimeout(call.timer);
      call.reject(
        new Error("Machine disconnected; check its session before retrying."),
      );
    }
    peer.pending.clear();
  }
  message(id: string, socket: MachineSocket, raw: string) {
    const peer = this.peers.get(id);
    if (!peer || peer.socket !== socket) return;
    if (Buffer.byteLength(raw) > 512000) {
      socket.close(1009, "Message too large");
      return;
    }
    try {
      const p = JSON.parse(raw);
      if (p.jsonrpc !== "2.0") return;
      if (p.id === undefined) {
        if (p.method === MACHINE_SESSION_CHANGED && peer.info) {
          const summary = sessionSummary.safeParse(p.params);
          if (summary.success) this.emit(id, summary.data);
        }
        return;
      }
      if (typeof p.id !== "number") return;
      const call = peer.pending.get(p.id);
      if (!call) return;
      peer.pending.delete(p.id);
      clearTimeout(call.timer);
      if (p.error)
        call.reject(
          new Error(
            typeof p.error.message === "string"
              ? p.error.message.slice(0, 1000)
              : "Machine request failed.",
          ),
        );
      else call.resolve(p.result);
    } catch {
      socket.close(1008, "Invalid message");
    }
  }
  request(id: string, method: string, params: unknown): Promise<unknown> {
    const peer = this.peers.get(id);
    if (!peer) return Promise.reject(new Error("Machine is offline."));
    if (peer.pending.size >= 64)
      return Promise.reject(new Error("Machine is busy; retry shortly."));
    const requestId = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        peer.pending.delete(requestId);
        reject(
          new Error(
            "Machine request timed out; check its session before retrying.",
          ),
        );
      }, 30000);
      peer.pending.set(requestId, { resolve, reject, timer });
      try {
        peer.socket.send(
          JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
        );
      } catch {
        peer.pending.delete(requestId);
        clearTimeout(timer);
        reject(new Error("Machine disconnected."));
      }
    });
  }
  supportsEvents(id: string): boolean {
    return this.peers.get(id)?.events === true;
  }
  list() {
    return this.grants.map((g) => ({
      id: g.id,
      name: g.name,
      connected: !!this.peers.get(g.id)?.info,
      roots: this.peers.get(g.id)?.info?.roots ?? [],
      providers: this.peers.get(g.id)?.info?.providers ?? [],
    }));
  }
  stop() {
    for (const peer of this.peers.values()) {
      this.reject(peer);
      peer.socket.close(1001, "Server shutting down");
    }
    this.peers.clear();
  }
}
