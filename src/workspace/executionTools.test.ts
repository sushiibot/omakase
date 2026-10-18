import { expect, spyOn, test } from "bun:test";
import { browserLifecycle } from "./executionTools.ts";

test("browser lifecycle touches only streaming sessions and cleans up after settlement and disposal", async () => {
  let tick = () => {};
  const timer = { unref: () => { unrefed = true; } };
  let unrefed = false;
  const interval = spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void, ms: number) => {
    expect(ms).toBe(60_000);
    tick = callback;
    return timer;
  }) as typeof setInterval);
  const clear = spyOn(globalThis, "clearInterval").mockImplementation(() => {});
  try {
    const session = { isStreaming: false };
    let touches = 0;
    let finishes = 0;
    const failure = new Error("cleanup failed");
    const errors: unknown[] = [];
    const lifecycle = browserLifecycle(session, {
      touch: () => { touches++; },
      finish: async () => { finishes++; throw failure; },
    }, err => errors.push(err));
    expect(unrefed).toBe(true);
    tick();
    expect(touches).toBe(0);
    session.isStreaming = true;
    tick();
    expect(touches).toBe(1);
    lifecycle.onEvent({ type: "turn_end" });
    expect(finishes).toBe(0);
    lifecycle.onEvent({ type: "agent_settled" });
    await Promise.resolve();
    expect(finishes).toBe(1);
    expect(errors).toEqual([failure]);
    lifecycle.dispose();
    await Promise.resolve();
    expect(clear).toHaveBeenCalledWith(timer);
    expect(finishes).toBe(2);
    expect(errors).toEqual([failure, failure]);
  } finally {
    interval.mockRestore();
    clear.mockRestore();
  }
});

test("a session without a browser does not start a heartbeat", () => {
  const interval = spyOn(globalThis, "setInterval");
  try {
    const lifecycle = browserLifecycle({ isStreaming: true }, undefined, () => { throw new Error("unexpected error"); });
    lifecycle.onEvent({ type: "agent_settled" });
    lifecycle.dispose();
    expect(interval).not.toHaveBeenCalled();
  } finally {
    interval.mockRestore();
  }
});
