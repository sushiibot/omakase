import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { machineId, machineInfo } from "./contracts.ts";
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
  pending: Map<
    number,
    {
      resolve(v: unknown): void;
      reject(e: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >;
}
export class MachineHub {
  private peers = new Map<string, Peer>();
  private nextId = 1;
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
    void this.request(id, "machine/info", {})
      .then((info) => {
        if (this.peers.get(id) === peer) peer.info = machineInfo.parse(info);
      })
      .catch(() => socket.close(1008, "Invalid machine information"));
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
      if (p.jsonrpc !== "2.0" || typeof p.id !== "number") return;
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
