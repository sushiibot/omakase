import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FLUSH_MARKER } from "./memoryFlush.ts";
import { createRichOutputGateExtension, RICH_OUTPUT_CUSTOM_TYPE, RICH_OUTPUT_INSTRUCTIONS } from "./richOutput.ts";

type Handler = (event: unknown, ctx?: unknown) => unknown;

function harness() {
  const handlers = new Map<string, Handler>();
  const pi = { on: (name: string, h: Handler) => handlers.set(name, h) } as unknown as ExtensionAPI;
  void createRichOutputGateExtension()(pi);
  return {
    start: (prompt = "how much should my cat eat") => handlers.get("before_agent_start")!({ type: "before_agent_start", prompt }),
    settle: (finalText: string, outcome = "completed") =>
      handlers.get("agent_before_settle")!({
        type: "agent_before_settle",
        outcome,
        continue: false,
        entries: [{ type: "custom", customType: "earlier" }],
        context: { contextEntries: [], contextMessages: [{ role: "assistant", content: [{ type: "text", text: finalText }] }] },
      }) as { entries: Array<{ type: string; customType: string; content: string; display: boolean }>; continue: boolean } | undefined,
  };
}

const bad = "Here:\n\n```breakdown\nsegments:\n  - { label: Morning, value: 117.5 kcal }\n```";
const good = "Here:\n\n```breakdown\nsegments:\n  - { label: Morning, value: 117.5 }\n```";

describe("rich output gate", () => {
  test("an invalid block gets one hidden repair message naming the problem", () => {
    const h = harness();
    h.start();
    const result = h.settle(bad);
    expect(result?.continue).toBe(true);
    expect(result?.entries[0]).toEqual({ type: "custom", customType: "earlier" } as never);
    const repair = result!.entries[1]!;
    expect(repair).toMatchObject({ type: "custom_message", customType: RICH_OUTPUT_CUSTOM_TYPE, display: false });
    expect(repair.content).toContain('- breakdown (line 3): segments[0].value: expected a number, got "117.5 kcal"');
    expect(repair.content).toContain("write the whole reply again with this fixed");
    // Once per run: a second bad reply settles.
    expect(h.settle(bad)).toBeUndefined();
  });

  test("valid blocks, plain replies, failed runs and memory flushes settle", () => {
    const h = harness();
    h.start();
    expect(h.settle(good)).toBeUndefined();
    expect(h.settle("no blocks here")).toBeUndefined();
    expect(h.settle(bad, "error")).toBeUndefined();
    h.start(`${FLUSH_MARKER} flush`);
    expect(h.settle(bad)).toBeUndefined();
  });

  test("a recipe written as markdown is sent back to be rewritten as a block", () => {
    const h = harness();
    h.start();
    const markdownRecipe = "## Miso salmon\n\n**Ingredients**\n\n- 2 salmon fillets\n- 1 tbsp miso\n\n### Instructions\n\n1. Mix.\n2. Bake 12 minutes.";
    const result = h.settle(markdownRecipe);
    expect(result?.continue).toBe(true);
    expect(result!.entries[1]!.content).toContain("Your last reply wrote a recipe as markdown. It must be a ```recipe block");
    expect(result!.entries[1]!.content).not.toContain("are invalid");
  });

  test("a new run can be repaired again", () => {
    const h = harness();
    h.start();
    expect(h.settle(bad)?.continue).toBe(true);
    h.start();
    expect(h.settle(bad)?.continue).toBe(true);
  });

  test("the prompt section comes from the catalog", () => {
    expect(RICH_OUTPUT_INSTRUCTIONS).toContain("```breakdown");
    expect(RICH_OUTPUT_INSTRUCTIONS).toContain(":::callout");
    expect(RICH_OUTPUT_INSTRUCTIONS.length).toBeLessThan(9000);
  });
});
