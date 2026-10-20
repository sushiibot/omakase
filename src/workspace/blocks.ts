import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
  BLOCKS_CHANGED,
  BLOCKS_MANAGE,
  blocksParams,
  liveBlock,
  liveBlockId,
  liveBlockOp,
  type BlockRequest,
  type LiveBlockOpWire,
  type LiveBlockRecord,
} from "../orchestration/blockContracts.ts";
import { RpcHandlerError } from "../orchestration/transport/client.ts";
import {
  applyLiveOps,
  describeLiveBlock,
  liveBlocks,
  newLiveBlock,
  parseLiveBlockId,
} from "../../web/src/lib/features/chat/render/rich/live.ts";
import type { LiveBlock, LiveBlockOp } from "../../web/src/lib/core/realtime/events.ts";
import { writeFileAtomic } from "./files.ts";
import { SAFE_OPEN } from "./runReader.ts";

/**
 * Live blocks: the stateful rich blocks in delivered replies (checklist, recipe, timer, actions,
 * choice, form). One file per reply, `<stateDir>/blocks/<messageKey>.json`, holding that reply's
 * blocks. The owner changes them from the web (blocks/manage), the agent with tools; every change
 * bumps the block's revision and is announced (blocks/changed) so every open device updates.
 * Shared numbering and change logic come from the web renderer's live.ts, so both sides agree.
 */

const FILE_MAX = 512 * 1024;
const LIST_MAX = 200;
/** The agent's context lists blocks changed within this window, or with a timer running. */
const RECENT_MS = 14 * 24 * 3600_000;
const CONTEXT_MAX = 8;

type Notify = (method: string, params: unknown) => void;

export class BlockStore {
  private readonly directory: string;
  /** The revision of each block the agent last saw, so its context can flag the owner's changes. */
  private readonly seen = new Map<string, number>();

  constructor(
    stateDir: string,
    private readonly opts: { principalId: string; notify?: Notify; now?: () => Date } = { principalId: "" },
  ) {
    this.directory = join(stateDir, "blocks");
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  private root(): string {
    mkdirSync(this.directory, { recursive: true });
    if (lstatSync(this.directory).isSymbolicLink()) throw new Error("Block directory cannot be a symlink");
    return realpathSync(this.directory);
  }

  private file(messageKey: string): string {
    return join(this.root(), `${messageKey}.json`);
  }

  /** A reply's blocks, or [] when it has none. Refuses links and oversized files. */
  private read(messageKey: string): LiveBlockRecord[] {
    let fd: number;
    try {
      fd = openSync(this.file(messageKey), SAFE_OPEN);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > FILE_MAX) throw new Error("Invalid block file");
      const blocks = liveBlock.array().parse(JSON.parse(readFileSync(fd, "utf8")));
      if (blocks.some((b) => b.messageKey !== messageKey)) throw new Error("Block identity mismatch");
      return blocks;
    } finally {
      closeSync(fd);
    }
  }

  private write(messageKey: string, blocks: LiveBlockRecord[]): void {
    writeFileAtomic(this.file(messageKey), JSON.stringify(blocks));
  }

  /** Stores the live blocks of a just-delivered reply. A reply without any stores nothing; one that
   *  was already registered (a resend) keeps its state. */
  register(conversationId: string, messageKey: string, text: string): LiveBlockRecord[] {
    const found = liveBlocks(text);
    if (!found.length || this.read(messageKey).length) return [];
    const now = this.now();
    const blocks = found.map((entry) => newLiveBlock(entry, messageKey, conversationId, now) as LiveBlockRecord);
    this.write(messageKey, blocks);
    return blocks;
  }

  get(id: string): LiveBlockRecord | null {
    const parsed = parseLiveBlockId(id);
    if (!parsed) return null;
    return this.read(parsed.messageKey).find((b) => b.id === id) ?? null;
  }

  listByMessages(messageKeys: readonly string[]): LiveBlockRecord[] {
    return [...new Set(messageKeys)].flatMap((key) => this.read(key));
  }

  /** Reply keys holding blocks, most recently changed first. */
  private keysByTime(): string[] {
    let names: string[];
    try {
      names = readdirSync(this.root()).filter((n) => /^[0-9A-Za-z_-]{8,64}\.json$/.test(n));
    } catch {
      return [];
    }
    return names
      .map((name) => {
        try {
          return { key: name.slice(0, -5), mtime: statSync(join(this.root(), name)).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((x) => x !== null)
      .sort((a, b) => b.mtime - a.mtime)
      .map((x) => x.key);
  }

  /** Every stored block of the most recently changed `maxReplies` replies (saved items). Unreadable
   *  files are skipped, so one bad file never hides the rest. */
  scan(maxReplies = 2000): { blocks: LiveBlockRecord[]; truncated: boolean } {
    const keys = this.keysByTime();
    const blocks: LiveBlockRecord[] = [];
    for (const key of keys.slice(0, maxReplies)) {
      try {
        blocks.push(...this.read(key));
      } catch {
        // Skipped: a link, an oversized or a corrupt file.
      }
    }
    return { blocks, truncated: keys.length > maxReplies };
  }

  /** The most recently changed blocks, newest first, optionally in one conversation. */
  recent(conversationId?: string, limit = LIST_MAX): LiveBlockRecord[] {
    const byTime = this.keysByTime().slice(0, LIST_MAX * 2).map((key) => ({ key }));
    const out: LiveBlockRecord[] = [];
    for (const { key } of byTime) {
      for (const block of this.read(key)) if (!conversationId || block.conversationId === conversationId) out.push(block);
      if (out.length >= limit) break;
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }

  /** Applies changes atomically, announces the new revision, and returns it. */
  apply(id: string, ops: readonly LiveBlockOpWire[], by: "owner" | "agent"): LiveBlockRecord {
    const parsed = parseLiveBlockId(id);
    const blocks = parsed ? this.read(parsed.messageKey) : [];
    const at = blocks.findIndex((b) => b.id === id);
    if (!parsed || at < 0) throw new RpcHandlerError("This block no longer exists.", -32040);
    const result = applyLiveOps(blocks[at] as LiveBlock, ops as LiveBlockOp[], by, this.now());
    if (!result.ok) throw new RpcHandlerError(result.error, -32042);
    const next = liveBlock.parse(result.block);
    if (next.revision === blocks[at]!.revision) return next;
    blocks[at] = next;
    this.write(parsed.messageKey, blocks);
    if (by === "agent") this.seen.set(id, next.revision);
    this.opts.notify?.(BLOCKS_CHANGED, { principalId: this.opts.principalId, block: next });
    return next;
  }

  manage(request: BlockRequest): { blocks: LiveBlockRecord[] } {
    switch (request.action) {
      case "list":
        return { blocks: this.listByMessages(request.messageKeys) };
      case "get": {
        const block = this.get(request.id);
        if (!block) throw new RpcHandlerError("This block no longer exists.", -32040);
        return { blocks: [block] };
      }
      case "apply":
        return { blocks: [this.apply(request.id, request.ops, "owner")] };
    }
  }

  handlers(principalId: string) {
    return {
      [BLOCKS_MANAGE]: async (raw: unknown) => {
        const params = blocksParams.parse(raw);
        if (params.principalId !== principalId) throw new RpcHandlerError("principal mismatch", -32602);
        return this.manage(params.request);
      },
    };
  }

  private line(block: LiveBlockRecord, now: Date): string {
    const ownerChanged = block.updatedBy === "owner" && (this.seen.get(block.id) ?? 0) < block.revision;
    const last = block.changes.at(-1);
    return `- ${block.id} ${block.type} "${block.title}": ${describeLiveBlock(block as LiveBlock, now)}` +
      (ownerChanged && last ? ` [owner changed it since you last looked: ${last.summary}]` : "");
  }

  /** The "Live blocks" section of the agent's context: this conversation's recent blocks and their state. */
  context(conversationId: string): string {
    const now = this.now();
    const blocks = this.recent(conversationId, 50)
      .filter((b) => now.getTime() - Date.parse(b.updatedAt) < RECENT_MS || !!b.state.endsAt)
      .slice(0, CONTEXT_MAX);
    if (!blocks.length) return "";
    // Lines first: they flag the owner's changes the agent hasn't seen, which this read then marks seen.
    const lines = blocks.map((b) => this.line(b, now));
    for (const b of blocks) this.seen.set(b.id, b.revision);
    return [
      "Live blocks in this conversation (checklists, recipes, timers and reply blocks the owner can change on any device). Current state, newest first. Use read_block for details and update_block to change one instead of writing it again:",
      ...lines,
    ].join("\n");
  }

  /** Agent tools and the context section, for one conversation's sessions. */
  extension(conversationId: string): ExtensionFactory {
    return (pi) => {
      let context = "";
      pi.on("before_agent_start", () => {
        try {
          context = this.context(conversationId);
        } catch {
          context = "";
        }
      });
      pi.on("context_with_system", ({ messages }) => {
        if (!context || messages[0]?.role !== "system") return;
        const [system, ...rest] = messages;
        return { messages: [{ ...system, sections: { ...system.sections, liveBlocks: context } }, ...rest] };
      });
      const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: {} });
      pi.registerTool({
        name: "list_blocks", label: "List live blocks",
        description: "List live blocks (checklists, recipes, timers, reply blocks) with their current state, newest first. scope: this conversation (default) or all.",
        parameters: Type.Object({ scope: Type.Optional(Type.Union([Type.Literal("conversation"), Type.Literal("all")])) }),
        execute: async (_id, input) => {
          const now = this.now();
          const blocks = this.recent(input.scope === "all" ? undefined : conversationId, 30);
          for (const b of blocks) this.seen.set(b.id, b.revision);
          return result(blocks.map((b) => ({ id: b.id, type: b.type, title: b.title, conversationId: b.conversationId, updatedAt: b.updatedAt, updatedBy: b.updatedBy, state: describeLiveBlock(b as LiveBlock, now) })));
        },
      });
      pi.registerTool({
        name: "read_block", label: "Read a live block",
        description: "Read one live block by id: its data, current state (checklist items with their ids, servings, timer), and recent changes with who made them.",
        parameters: Type.Object({ id: Type.String({ maxLength: 80 }) }),
        execute: async (_id, input) => {
          const block = liveBlockId.safeParse(input.id).success ? this.get(input.id) : null;
          if (!block) throw new Error(`No live block ${input.id}. Use list_blocks to find one.`);
          this.seen.set(block.id, block.revision);
          return result({ ...block, summary: describeLiveBlock(block as LiveBlock, this.now()) });
        },
      });
      pi.registerTool({
        name: "update_block", label: "Update a live block",
        description:
          "Change a live block; the owner sees it at once on every device. ops, applied in order and all-or-nothing: " +
          "checklist: {op:'check', item, done}, {op:'add', text}, {op:'edit', item, text}, {op:'remove', item} (item is the item id from read_block); " +
          "recipe: {op:'serves', n}, {op:'got', item, done} (item is the ingredient index); " +
          "timer: {op:'start'}, {op:'pause'}, {op:'reset'}, {op:'duration', seconds}.",
        parameters: Type.Object({
          id: Type.String({ maxLength: 80 }),
          ops: Type.Array(Type.Object({
            op: Type.String(),
            item: Type.Optional(Type.Integer()),
            done: Type.Optional(Type.Boolean()),
            text: Type.Optional(Type.String({ maxLength: 200 })),
            n: Type.Optional(Type.Integer()),
            seconds: Type.Optional(Type.Integer()),
          }), { minItems: 1, maxItems: 20 }),
        }),
        execute: async (_id, input) => {
          const ops = input.ops.map((op, i) => {
            const parsed = liveBlockOp.safeParse(op);
            if (!parsed.success) throw new Error(`ops[${i}] is not a valid change: ${parsed.error.issues[0]?.message ?? "invalid"}`);
            if (parsed.data.op === "sent") throw new Error("Only the owner answers a reply block.");
            return parsed.data;
          });
          const block = this.apply(input.id, ops, "agent");
          return result({ id: block.id, revision: block.revision, state: describeLiveBlock(block as LiveBlock, this.now()) });
        },
      });
    };
  }
}

export const BLOCK_TOOLS = ["list_blocks", "read_block", "update_block"];
