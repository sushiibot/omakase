import { RPC_METHODS, type ChatDeliverParams } from "../orchestration/contracts.ts";
import { RpcErrorResponse } from "../orchestration/transport/client.ts";
import { getLogger } from "../logger.ts";
import { Outbox, type OutboxEntry } from "./outbox.ts";

const log = getLogger("workspace.delivery");
const RESEND_INTERVAL_MS = 60_000;
// Bound unanswered requests so they can be retried after a register race.
const DELIVER_TIMEOUT_MS = 30_000;

interface DeliveryOptions {
  transport: {
    request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
    isConnected?(): boolean;
  };
  resendIntervalMs?: number;
  deliverTimeoutMs?: number;
  /** Returns a cancellation function; injected clocks keep retry tests deterministic. */
  scheduleRetry?: (retry: () => void, intervalMs: number) => () => void;
}

/** Sends persisted deliveries. Only an explicit acknowledgement retires an entry. */
export class DeliveryTransport {
  private readonly sending = new Set<string>();
  private stopRetry: (() => void) | null = null;
  private botFeatures: readonly string[] | null = null;

  constructor(private readonly outbox: Outbox, private readonly opts: DeliveryOptions) {}

  get alertsUnsupported(): boolean {
    return this.botFeatures !== null && !this.botFeatures.includes("alert");
  }

  ownsDelivery(outboxId: string): boolean { return this.outbox.unacked().some(e => e.outboxId === outboxId); }
  hasUnackedDeliveries(): boolean { return this.outbox.unacked().length > 0; }

  handleAck(outboxId: string): Record<string, never> {
    if (!this.outbox.ack(outboxId)) log.debug({ outboxId }, "ack for an unknown or already-acked outbox entry");
    return {};
  }

  onRegistered(features: readonly string[] = []): void {
    this.botFeatures = features;
    if (this.alertsUnsupported) for (const entry of this.outbox.unacked()) if (entry.kind === "alert") this.downgradeAlert(entry);
    this.resendUnacked();
    if (this.stopRetry) return;
    const schedule = this.opts.scheduleRetry ?? ((retry, ms) => {
      const timer = setInterval(retry, ms);
      timer.unref?.();
      return () => clearInterval(timer);
    });
    this.stopRetry = schedule(() => {
      if (this.opts.transport.isConnected?.() ?? true) this.resendUnacked();
    }, this.opts.resendIntervalMs ?? RESEND_INTERVAL_MS);
  }

  resendUnacked(): void {
    for (const entry of this.outbox.unacked()) {
      if (!this.sending.has(entry.outboxId)) this.send(entry);
    }
  }

  dispose(): void {
    this.stopRetry?.();
    this.stopRetry = null;
  }

  /** Rewrites a queued alert as its proactive text; `alert` must go, since the contract refuses it on a proactive. */
  private downgradeAlert(entry: OutboxEntry): OutboxEntry {
    const { alert: _alert, ...rest } = entry;
    const text: OutboxEntry = { ...rest, kind: "proactive" };
    this.outbox.replace(text);
    return text;
  }

  send(entry: OutboxEntry): void {
    if (entry.kind === "session" && !this.botFeatures?.includes("session")) return;
    if (entry.kind === "alert") {
      // Unregistered: whether the bot takes alerts is unknown, and the register resends everything anyway.
      if (this.botFeatures === null) return;
      if (!this.botFeatures.includes("alert")) entry = this.downgradeAlert(entry);
    }
    this.sending.add(entry.outboxId);
    let params: ChatDeliverParams;
    try {
      params = this.outbox.wire(entry);
    } catch (err) {
      this.sending.delete(entry.outboxId);
      log.warn({ err, outboxId: entry.outboxId }, "building chat/deliver failed; will resend");
      return;
    }
    this.opts.transport
      .request(RPC_METHODS.chatDeliver, params, this.opts.deliverTimeoutMs ?? DELIVER_TIMEOUT_MS)
      .catch((err) => {
        log.warn({ err, outboxId: entry.outboxId }, "chat/deliver not confirmed; will resend");
        // An alert the bot can't take would be refused on every resend; any other error may pass.
        if (entry.kind === "alert" && isContractRefusal(err)) this.downgradeAlert(entry);
      })
      .finally(() => this.sending.delete(entry.outboxId));
  }

}

/** The bot refused the request's params: -32602 from a bot that says so, or a zod issue list in a generic
 *  -32000 from one that predates `alert`. */
export function isContractRefusal(err: unknown): boolean {
  if (!(err instanceof RpcErrorResponse)) return false;
  if (err.code === -32601 || err.code === -32602) return true;
  if (err.code !== -32000) return false;
  try {
    const issues = JSON.parse(err.message) as unknown;
    return Array.isArray(issues) && issues.length > 0 && issues.every((i) => typeof i === "object" && i !== null && "code" in i && "path" in i);
  } catch {
    return false;
  }
}
