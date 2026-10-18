import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RPC_METHODS, type ChatDeliverParams } from "../orchestration/contracts.ts";
import { RpcErrorResponse } from "../orchestration/transport/client.ts";
import { DeliveryTransport } from "./deliveryTransport.ts";
import { Outbox, type OutboxEntry } from "./outbox.ts";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
const alert: OutboxEntry = {
  outboxId: "alert-1", principalId: "owner", kind: "alert", text: "Job failed",
  alert: { source: "job", job: "nightly", kind: "failed", trigger: "daily", startedAt: "2026-09-29T04:00:00.000Z", error: "boom", schedule: "daily 04:00" },
};
const text: OutboxEntry = { outboxId: "text-1", principalId: "owner", kind: "proactive", text: "Hello" };

function setup(entries: OutboxEntry[]) {
  const dir = mkdtempSync(join(tmpdir(), "delivery-transport-"));
  const outbox = new Outbox(dir);
  for (const entry of entries) outbox.append(entry);
  const requests: { method: string; params: ChatDeliverParams; timeout?: number; resolve: (value: unknown) => void; reject: (error: unknown) => void }[] = [];
  let connected = true;
  let now = 0;
  let timer: { next: number; interval: number; retry: () => void } | null = null;
  let scheduled = 0;
  const delivery = new DeliveryTransport(outbox, {
    transport: {
      request: (method, params, timeout) => new Promise((resolve, reject) => requests.push({ method, params: params as ChatDeliverParams, timeout, resolve, reject })),
      isConnected: () => connected,
    },
    resendIntervalMs: 100,
    deliverTimeoutMs: 30,
    scheduleRetry: (retry, interval) => {
      scheduled++;
      timer = { retry, interval, next: now + interval };
      return () => { timer = null; };
    },
  });
  cleanups.push(() => { delivery.dispose(); rmSync(dir, { recursive: true, force: true }); });
  return {
    delivery, outbox, requests, dir,
    connect: (value: boolean) => { connected = value; },
    schedules: () => scheduled,
    advance: (ms: number) => {
      const end = now + ms;
      while (timer && timer.next <= end) { now = timer.next; timer.next += timer.interval; timer.retry(); }
      now = end;
    },
  };
}

test("in-flight requests suppress retries; send success remains pending until explicit ack", async () => {
  const h = setup([text]);
  h.delivery.onRegistered();
  expect(h.requests[0]).toMatchObject({ method: RPC_METHODS.chatDeliver, params: text, timeout: 30 });
  h.advance(300);
  h.delivery.resendUnacked();
  expect(h.requests).toHaveLength(1);
  h.requests[0]!.resolve({});
  await settle();
  expect(h.delivery.ownsDelivery(text.outboxId)).toBe(true);
  h.advance(100);
  expect(h.requests).toHaveLength(2);
  h.delivery.handleAck(text.outboxId);
  h.delivery.handleAck(text.outboxId);
  h.requests[1]!.resolve({});
  await settle();
  h.advance(200);
  expect(h.requests).toHaveLength(2);
  expect(new Outbox(h.dir).unacked()).toEqual([]);
});

test("interval checks connectivity, registration retries immediately and dispose cancels retries", async () => {
  const h = setup([text]);
  h.delivery.onRegistered();
  h.requests[0]!.reject(new Error("disconnected"));
  await settle();
  h.connect(false);
  h.advance(100);
  expect(h.requests).toHaveLength(1);
  h.connect(true);
  h.delivery.onRegistered();
  expect(h.requests).toHaveLength(2);
  expect(h.schedules()).toBe(1);
  h.requests[1]!.resolve({});
  await settle();
  h.delivery.dispose();
  h.advance(1000);
  expect(h.requests).toHaveLength(2);
  expect(h.delivery.hasUnackedDeliveries()).toBe(true);
});

test("unknown alerts wait; unsupported alerts persist as text with the same id and position", () => {
  const h = setup([alert, text]);
  h.delivery.send(alert);
  expect(h.requests).toHaveLength(0);
  h.delivery.onRegistered([]);
  expect(h.requests.map(r => r.params.outboxId)).toEqual([alert.outboxId, text.outboxId]);
  expect(h.requests[0]!.params.kind).toBe("proactive");
  expect(h.requests[0]!.params.alert).toBeUndefined();
  expect(new Outbox(h.dir).unacked()).toEqual(h.outbox.unacked());
});

test("session deliveries remain pending until feature support is registered", () => {
  const entry: OutboxEntry = { ...text, kind: "session" };
  const h = setup([entry]);
  h.delivery.send(entry);
  h.delivery.onRegistered([]);
  h.advance(100);
  expect(h.requests).toHaveLength(0);
  expect(h.delivery.hasUnackedDeliveries()).toBe(true);
  h.delivery.onRegistered(["session"]);
  expect(h.requests[0]!.params).toEqual(entry);
});

test("contract refusal downgrades on the next retry, while ordinary errors preserve alerts", async () => {
  const h = setup([alert]);
  h.delivery.onRegistered(["alert"]);
  h.requests[0]!.reject(new Error("temporary"));
  await settle();
  h.advance(100);
  expect(h.requests[1]!.params.kind).toBe("alert");
  h.requests[1]!.reject(new RpcErrorResponse("invalid params", -32602));
  await settle();
  expect(new Outbox(h.dir).unacked()[0]!.kind).toBe("proactive");
  h.advance(100);
  expect(h.requests[2]!.params).toEqual({ ...text, outboxId: alert.outboxId, text: alert.text });
});

test("a late refusal after acknowledgement cannot resurrect a delivery", async () => {
  const h = setup([alert]);
  h.delivery.onRegistered(["alert"]);
  h.delivery.handleAck(alert.outboxId);
  h.requests[0]!.reject(new RpcErrorResponse("invalid params", -32602));
  await settle();
  h.advance(300);
  expect(h.requests).toHaveLength(1);
  expect(new Outbox(h.dir).unacked()).toEqual([]);
});

test("feature rollback rewrites an in-flight alert but waits for its request to settle", async () => {
  const h = setup([alert]);
  h.delivery.onRegistered(["alert"]);
  h.delivery.onRegistered([]);
  expect(h.requests).toHaveLength(1);
  expect(new Outbox(h.dir).unacked()[0]!.kind).toBe("proactive");
  h.requests[0]!.resolve({});
  await settle();
  h.advance(100);
  expect(h.requests[1]!.params).toMatchObject({ outboxId: alert.outboxId, kind: "proactive" });
  expect(h.requests[1]!.params.alert).toBeUndefined();
});

test("a wire-building failure releases the retry slot without acknowledging the entry", () => {
  const h = setup([text]);
  const wire = h.outbox.wire.bind(h.outbox);
  h.outbox.wire = () => { throw new Error("unavailable file store"); };
  h.delivery.onRegistered();
  expect(h.requests).toHaveLength(0);
  expect(h.delivery.hasUnackedDeliveries()).toBe(true);
  h.outbox.wire = wire;
  h.advance(100);
  expect(h.requests[0]!.params).toEqual(text);
});
