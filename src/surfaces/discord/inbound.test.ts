import { describe, expect, test } from "bun:test";
import { mentionsBot } from "./inbound.ts";

const BOT = "900";

function mentions(opts: { user?: boolean; roleOrEveryone?: boolean }) {
  return {
    has: (id: string) => id === BOT && Boolean(opts.user || opts.roleOrEveryone),
    users: { has: (id: string) => id === BOT && Boolean(opts.user) },
  };
}

describe("mentionsBot", () => {
  test("a direct user mention triggers with or without MessageContent", () => {
    expect(mentionsBot(mentions({ user: true }), BOT, true)).toBe(true);
    expect(mentionsBot(mentions({ user: true }), BOT, false)).toBe(true);
  });

  test("a role or @everyone ping triggers only with MessageContent", () => {
    expect(mentionsBot(mentions({ roleOrEveryone: true }), BOT, true)).toBe(true);
    expect(mentionsBot(mentions({ roleOrEveryone: true }), BOT, false)).toBe(false);
  });

  test("no mention never triggers", () => {
    expect(mentionsBot(mentions({}), BOT, true)).toBe(false);
    expect(mentionsBot(mentions({}), BOT, false)).toBe(false);
  });
});
