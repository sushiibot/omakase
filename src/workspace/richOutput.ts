import type { BoundaryResult, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { richOutputInstructions } from "../../web/src/lib/features/chat/render/rich/blocks.ts";
import { lintRichMarkdown, missedBlocks, richRepairMessage } from "../../web/src/lib/features/chat/render/rich/syntax.ts";
import { FLUSH_MARKER } from "./memoryFlush.ts";
import { lastAssistantText } from "./verifyGate.ts";

/**
 * Rich reply blocks (```breakdown, :::callout, ...). The catalog, its schemas and the parser live with
 * the web renderer and are imported here unchanged, so this check and the renderer reach the same
 * verdict on every block. A reply with a block that won't render, or with a recipe written as plain
 * markdown, is held open once: the model is told exactly what is wrong and asked to write the reply
 * again with it fixed, because the run delivers only its last reply.
 */

export const RICH_OUTPUT_CUSTOM_TYPE = "sushii-rich-output";

/** The prompt section, generated from the catalog so it can't drift from what renders. */
export const RICH_OUTPUT_INSTRUCTIONS = richOutputInstructions();

type Log = { info: (obj: object, msg: string) => void };

export function createRichOutputGateExtension(opts: { log?: Log } = {}): ExtensionFactory {
  return (pi) => {
    let hidden = false;
    let nudged = false;

    pi.on("before_agent_start", (event) => {
      hidden = event.prompt.startsWith(FLUSH_MARKER);
      nudged = false;
    });

    pi.on("agent_before_settle", (event): BoundaryResult | undefined => {
      if (event.outcome !== "completed" || hidden || nudged) return undefined;
      const text = lastAssistantText(event.context);
      const problems = lintRichMarkdown(text);
      const missed = missedBlocks(text);
      const content = richRepairMessage(problems, missed);
      if (!content) return undefined;
      nudged = true;
      opts.log?.info({ missed, problems: problems.map((p) => ({ block: p.block, line: p.line, count: p.messages.length })) }, "rich output: invalid or missing blocks; asking for a rewrite");
      return {
        entries: [...event.entries, { type: "custom_message", customType: RICH_OUTPUT_CUSTOM_TYPE, content, display: false }],
        continue: true,
      };
    });
  };
}
