import { describe, expect, test } from "bun:test";
import { BEHAVIOR_INSTRUCTIONS } from "../../modules/moderation/prompt.ts";
import { DISCORD_FORMATTING } from "./conventions.ts";
import { GENERAL_BEHAVIOR, guildBehavior } from "./personas.ts";

describe("Discord personas", () => {
  test("a guild without promptTemplate keeps the moderation persona", () => {
    expect(guildBehavior({})).toBe(BEHAVIOR_INSTRUCTIONS);
    expect(guildBehavior({ promptTemplate: "moderation" })).toBe(BEHAVIOR_INSTRUCTIONS);
    expect(guildBehavior({ promptTemplate: "general" })).toBe(GENERAL_BEHAVIOR);
  });

  test("every persona carries the shared Discord formatting rules", () => {
    for (const p of [BEHAVIOR_INSTRUCTIONS, GENERAL_BEHAVIOR]) expect(p).toContain(DISCORD_FORMATTING);
  });

  test("the general persona is not a moderation assistant", () => {
    expect(GENERAL_BEHAVIOR).not.toContain("moderation intelligence assistant");
    expect(GENERAL_BEHAVIOR).not.toContain("Recommended action");
  });
});
