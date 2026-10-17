import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { applySchema } from "../../db/index.ts";
import { SqliteChatLog } from "./chatLog.ts";
import { encodeEvent, parseCursor, sseResponse } from "./sse.ts";

function log() {
  const db = new Database(":memory:");
  applySchema(db);
  return new SqliteChatLog(db);
}

const NONE = { approvals: [], asks: [] };

async function drain(res: Response): Promise<string> {
  return await new Response(res.body).text();
}

describe("sse", () => {
  test("encodes durable events with an id and ephemeral ones without", () => {
    expect(new TextDecoder().decode(encodeEvent({ seq: 7, type: "session", data: { kind: "new" } }))).toBe('id: 7\nevent: session\ndata: {"kind":"new"}\n\n');
    expect(new TextDecoder().decode(encodeEvent({ type: "workspace", data: { state: "online" } }))).toBe('event: workspace\ndata: {"state":"online"}\n\n');
  });

  test("parses the cursor from the query first, then Last-Event-ID", () => {
    expect(parseCursor(new Request("http://x/s?after=5", { headers: { "Last-Event-ID": "9" } }))).toBe(5);
    expect(parseCursor(new Request("http://x/s", { headers: { "Last-Event-ID": "9" } }))).toBe(9);
    expect(parseCursor(new Request("http://x/s"))).toBeNull();
    expect(parseCursor(new Request("http://x/s?after=-1"))).toBeUndefined();
  });

  test("closes at the lifetime and runs the close hook once", async () => {
    const chat = log();
    let opened = 0;
    let closed = 0;
    const res = sseResponse(chat, null, {
      heartbeatMs: 1_000,
      maxLifetimeMs: 20,
      onOpen: () => (opened++, () => closed++),
      hello: () => ({ workspace: "offline", openTurns: [], pending: NONE }),
    });
    const text = await drain(res);
    expect(text).toStartWith("event: hello\n");
    expect([opened, closed, chat.subscribers]).toEqual([1, 1, 0]);
  });

  test("an aborted request closes the stream", async () => {
    const chat = log();
    const ctrl = new AbortController();
    const res = sseResponse(chat, null, { heartbeatMs: 1_000, maxLifetimeMs: 60_000, onOpen: () => () => {}, hello: () => ({ workspace: "online", openTurns: [], pending: NONE }), signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 10);
    await drain(res);
    expect(chat.subscribers).toBe(0);
  });

  test("a client that stops reading is cut off instead of buffering without bound", async () => {
    const chat = log();
    const res = sseResponse(chat, null, { heartbeatMs: 1_000, maxLifetimeMs: 60_000, onOpen: () => () => {}, hello: () => ({ workspace: "online", openTurns: [], pending: NONE }), maxBufferedBytes: 1024 });
    for (let i = 0; i < 1000; i++) chat.publish({ type: "delta", data: { turnId: "t", offset: i * 100, text: "x".repeat(100) } });
    expect(chat.subscribers).toBe(0);
    await res.body!.cancel();
  });

  test("a replay past the buffer cap closes the stream before it opens, leaking no timer, presence or subscription", async () => {
    const chat = log();
    for (let i = 0; i < 200; i++) chat.append("proactive", { key: `k${i}`, text: "x".repeat(1000), files: [] }, `k${i}`);
    let opened = 0;
    let intervals = 0;
    const realSetInterval = globalThis.setInterval;
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => (intervals++, realSetInterval(...args))) as typeof setInterval;
    try {
      const ctrl = new AbortController();
      const res = sseResponse(chat, 0, {
        heartbeatMs: 1_000,
        maxLifetimeMs: 60_000,
        onOpen: () => (opened++, () => {}),
        hello: () => ({ workspace: "online", openTurns: [], pending: NONE }),
        signal: ctrl.signal,
        maxBufferedBytes: 1024,
      });
      await drain(res);
      expect([opened, intervals, chat.subscribers]).toEqual([0, 0, 0]);
    } finally {
      globalThis.setInterval = realSetInterval;
    }
  });

  test("an event that fails to encode closes the stream instead of leaving it silent", async () => {
    const chat = log();
    const res = sseResponse(chat, null, { heartbeatMs: 1_000, maxLifetimeMs: 60_000, onOpen: () => () => {}, hello: () => ({ workspace: "online", openTurns: [], pending: NONE }) });
    chat.publish({ type: "delta", data: { turnId: "t", offset: 0, text: 1n as unknown as string } });
    expect(chat.subscribers).toBe(0);
    expect(await drain(res)).toStartWith("event: hello\n");
  });

  test("the first frame carries the pending approvals and asks, on a reset too", async () => {
    const chat = log();
    chat.append("session", { kind: "new" });
    const pending = { approvals: [{ seq: 1, at: "2026-09-30T00:00:00.000Z", nonce: "n".repeat(16), view: { tool: "t", agentId: "main", agentName: "Main", fields: [] } }], asks: [] };
    const open = (after: number | null) =>
      sseResponse(chat, after, { heartbeatMs: 1_000, maxLifetimeMs: 10, onOpen: () => () => {}, hello: () => ({ workspace: "online", openTurns: [], pending }) });
    const hello = await drain(open(null));
    const reset = await drain(open(99));
    expect(hello).toContain(`"pending":${JSON.stringify(pending)}`);
    expect(reset).toStartWith(`event: reset\ndata: {"headSeq":1,"workspace":"online","pending":${JSON.stringify(pending)}}`);
  });
});

test("versions arrive on connect/reset and live changes without altering the durable cursor; subscriptions close", async () => {
  const chat = log();
  chat.append("session", { kind: "new" });
  let emit: ((v: import('./events.ts').AppVersions) => void) | undefined;
  let closed = 0;
  const updates = {
    current: () => ({ web: 'one', android: null }),
    subscribe(fn: NonNullable<typeof emit>) { emit = fn; return () => { closed++; }; },
  };
  for (const after of [null, 999]) {
    const res = sseResponse(chat, after, { heartbeatMs: 1000, maxLifetimeMs: 20, onOpen: () => () => {}, hello: () => ({ workspace: 'online', openTurns: [], pending: NONE }), updates });
    emit?.({ web: 'two', android: null });
    emit?.({ web: 'two', android: null });
    const text = await drain(res);
    expect(text).toStartWith(after === null ? 'event: hello' : 'event: reset');
    expect(text.match(/event: app_update/g)).toHaveLength(2);
    expect(text).toContain('event: app_update\ndata: {"web":"one","android":null}');
    expect(text).toContain('event: app_update\ndata: {"web":"two","android":null}');
  }
  expect(closed).toBe(2);
  expect(chat.head()).toBe(1);
});
