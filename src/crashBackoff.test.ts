import { describe, expect, test } from "bun:test";
import { nextCrashDelay } from "./crashBackoff.ts";

describe("nextCrashDelay", () => {
  test("first crash waits the base delay", () => {
    expect(nextCrashDelay(null, 1000).delayMs).toBe(5_000);
  });

  test("doubles on consecutive crashes and caps at 5 minutes", () => {
    let state = nextCrashDelay(null, 0).state;
    const delays: number[] = [];
    for (let i = 1; i <= 8; i++) {
      const next = nextCrashDelay(state, i * 1000);
      delays.push(next.delayMs);
      state = next.state;
    }
    expect(delays).toEqual([10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000]);
  });

  test("resets after a long healthy run", () => {
    expect(nextCrashDelay({ count: 6, at: 0 }, 11 * 60_000).delayMs).toBe(5_000);
  });
});
