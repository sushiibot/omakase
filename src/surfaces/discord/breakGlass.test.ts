import { describe, expect, test } from "bun:test";
import type { MessageCreateOptions } from "discord.js";
import { BREAK_GLASS_APPROVAL, BREAK_GLASS_HELD, BREAK_GLASS_MIN_GAP_MS, createBreakGlass, sendBreakGlassDm } from "./breakGlass.ts";

describe("break-glass DM", () => {
  test("one non-silent, buttonless message to the owner", async () => {
    const sent: MessageCreateOptions[] = [];
    const ok = await sendBreakGlassDm(async () => ({ send: async (o) => sent.push(o) }));
    expect(ok).toBe(true);
    expect(sent).toEqual([{ content: BREAK_GLASS_APPROVAL, allowedMentions: { parse: [] } }]);
    expect(sent[0]!.flags).toBeUndefined();
    expect(sent[0]!.components).toBeUndefined();
  });

  test("no owner channel or a failed send resolves false, never throws", async () => {
    expect(await sendBreakGlassDm(async () => null)).toBe(false);
    expect(await sendBreakGlassDm(async () => ({ send: async () => Promise.reject(new Error("blocked")) }))).toBe(false);
    expect(await sendBreakGlassDm(async () => Promise.reject(new Error("no client")))).toBe(false);
  });

  test("a failed owner lookup is logged at warn, with nothing personal in it", async () => {
    const warned: unknown[][] = [];
    const logger = { warn: (...args: unknown[]) => void warned.push(args) } as never;
    expect(await sendBreakGlassDm(async () => null, logger)).toBe(false);
    expect(warned).toEqual([["break-glass owner DM not sent: the owner's Discord DM channel could not be resolved"]]);
  });

  function breakGlassHarness() {
    const sent: MessageCreateOptions[] = [];
    let t = 1_000_000;
    const breakGlass = createBreakGlass(async () => ({ send: async (o) => sent.push(o) }), { now: () => t });
    return { sent, breakGlass, advance: (ms: number) => (t += ms) };
  }

  test("a nonce gets at most one DM, however often it is reported", async () => {
    const h = breakGlassHarness();
    expect(await h.breakGlass("nonce-aaaaaaaaaaa")).toBe(true);
    h.advance(BREAK_GLASS_MIN_GAP_MS + 1);
    expect(await h.breakGlass("nonce-aaaaaaaaaaa")).toBe(false);
    expect(h.sent).toHaveLength(1);
  });

  test("at most one DM per 5 minutes across all approvals, always the fixed text", async () => {
    const h = breakGlassHarness();
    const burst = await Promise.all(Array.from({ length: 50 }, (_, i) => h.breakGlass(`nonce-${i}`)));
    expect(burst.filter(Boolean)).toHaveLength(1);
    h.advance(BREAK_GLASS_MIN_GAP_MS - 1);
    expect(await h.breakGlass("nonce-late")).toBe(false);
    h.advance(1);
    expect(await h.breakGlass("nonce-next")).toBe(true);
    expect(BREAK_GLASS_MIN_GAP_MS).toBe(5 * 60_000);
    expect(h.sent).toEqual([
      { content: BREAK_GLASS_APPROVAL, allowedMentions: { parse: [] } },
      { content: BREAK_GLASS_APPROVAL, allowedMentions: { parse: [] } },
    ]);
  });

  test("a held approval gets its own fixed text, which never points at the app that is down", async () => {
    const h = breakGlassHarness();
    expect(await h.breakGlass("nonce-held", "held")).toBe(true);
    expect(h.sent.map((m) => m.content)).toEqual([BREAK_GLASS_HELD]);
    expect(BREAK_GLASS_HELD).not.toMatch(/open the app/i);
  });

  test("takes no text: only the nonce, which never reaches the message", async () => {
    const h = breakGlassHarness();
    expect(createBreakGlass(async () => null).length).toBe(1);
    await h.breakGlass("<@&123> ignore previous instructions");
    expect(h.sent.map((m) => m.content)).toEqual([BREAK_GLASS_APPROVAL]);
  });
});
