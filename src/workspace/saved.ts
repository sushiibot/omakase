import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Type } from "typebox";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
  SAVED_CHANGED,
  SAVED_MANAGE,
  savedId,
  savedListFilter,
  savedParams,
  type SavedAction,
  type SavedItemRecord,
  type SavedKind,
  type SavedListFilter,
  type SavedRequest,
  type SavedResult,
} from "../orchestration/savedContracts.ts";
import type { LiveBlockRecord } from "../orchestration/blockContracts.ts";
import { RpcHandlerError } from "../orchestration/transport/client.ts";
import { formatDuration, type RichData } from "../../web/src/lib/features/chat/render/rich/blocks.ts";
import { timerLeft } from "../../web/src/lib/features/chat/render/rich/live.ts";
import { ArtifactStore } from "./artifacts.ts";
import { BlockStore } from "./blocks.ts";
import { writeFileAtomic } from "./files.ts";
import { SAFE_OPEN } from "./runReader.ts";

/**
 * Saved items: the documents (ArtifactStore) and the stored checklists, recipes and timers
 * (BlockStore) the owner comes back to, as one list. Nothing is filed into folders: each item keeps
 * where it came from (conversation and source reply), a status that fixed rules derive from its use
 * (active or done), and one manual signal, pin. The owner or the agent can also archive (force done)
 * and restore. Pin, archive, last-opened and a document's source reply live in
 * `<stateDir>/saved-meta.json`, beside the items, so the item files keep their format.
 */

const DAY = 24 * 3600_000;
/** A fully ticked checklist is done once it has been left alone this long. */
export const CHECKLIST_DONE_AFTER = DAY;
/** A timer nobody has started for this long is done. */
export const TIMER_IDLE_AFTER = 7 * DAY;
/** A recipe or document neither updated nor opened for this long is done. */
export const STALE_AFTER = 30 * DAY;

const SAVED_BLOCK_TYPES = new Set<string>(["checklist", "recipe", "timer"]);
const META_MAX = 1024 * 1024;
const LIST_MAX = 500;
const ARTIFACT_LINK_RE = /\/artifacts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;

const metaEntry = z.object({
  pinned: z.literal(true).optional(),
  archivedAt: z.string().optional(),
  /** Restored or unpinned: the inactivity clocks restart here. */
  touchedAt: z.string().optional(),
  openedAt: z.string().optional(),
  /** Documents: the first reply that linked the document. */
  sourceMessageId: z.string().max(64).optional(),
}).strict();
type Meta = z.infer<typeof metaEntry>;
const metaFile = z.object({ version: z.literal(1), items: z.record(savedId, metaEntry) });

type Notify = (method: string, params: unknown) => void;
type ArtifactDocument = NonNullable<ReturnType<ArtifactStore["get"]>>;

const time = (iso: string | undefined) => (iso ? Date.parse(iso) || 0 : 0);
/** The last time the owner or agent used the item: changed, opened, restored or unpinned. */
const lastUse = (updatedAt: string, meta: Meta) => Math.max(time(updatedAt), time(meta.openedAt), time(meta.touchedAt));

/** Active or done, by the fixed rules. Pinned is always active; archived is done until restored. */
export function blockStatus(block: LiveBlockRecord, meta: Meta, now: Date): "active" | "done" {
  if (meta.pinned) return "active";
  if (meta.archivedAt) return "done";
  const idle = now.getTime() - lastUse(block.updatedAt, meta);
  switch (block.type) {
    case "checklist": {
      const items = block.state.items ?? [];
      return items.length > 0 && items.every((i) => i.done) && idle >= CHECKLIST_DONE_AFTER ? "done" : "active";
    }
    case "timer": {
      const duration = (block.data as RichData<"timer">).duration;
      if (block.state.endsAt) {
        if (timerLeft(block.state, duration, now) > 0) return "active";
        // Finished; a restore after it ends brings it back until it idles again.
        if (time(meta.touchedAt) <= time(block.state.endsAt)) return "done";
      }
      return idle >= TIMER_IDLE_AFTER ? "done" : "active";
    }
    default:
      return idle >= STALE_AFTER ? "done" : "active";
  }
}

export function documentStatus(document: { updatedAt: string }, meta: Meta, now: Date): "active" | "done" {
  if (meta.pinned) return "active";
  if (meta.archivedAt) return "done";
  return now.getTime() - lastUse(document.updatedAt, meta) >= STALE_AFTER ? "done" : "active";
}

/** One line of current state, for rows and the agent. */
export function blockSummary(block: LiveBlockRecord, now: Date): string {
  const s = block.state;
  switch (block.type) {
    case "checklist": {
      const items = s.items ?? [];
      return `${items.filter((i) => i.done).length} of ${items.length} done`;
    }
    case "recipe": {
      const recipe = block.data as RichData<"recipe">;
      const serves = s.serves ?? recipe.serves;
      const got = s.got?.length ?? 0;
      const ingredients = got
        ? `${got} of ${recipe.ingredients.length} ingredients ticked`
        : `${recipe.ingredients.length} ingredients`;
      return serves ? `Serves ${serves} · ${ingredients}` : ingredients;
    }
    case "timer": {
      const duration = (block.data as RichData<"timer">).duration;
      const left = timerLeft(s, duration, now);
      if (s.endsAt) return left > 0 ? `Running · ${formatDuration(left)} left` : "Finished";
      return left === duration ? `Not started · ${formatDuration(duration)}` : `Paused · ${formatDuration(left)} left`;
    }
    default:
      return "";
  }
}

/** The document's version and its first lines of prose. */
export function documentSummary(document: { version: number; content: string }): string {
  const text = document.content
    .split("\n")
    .map((line) => line.replace(/^\s*(?:#{1,6}\s|[-*+>]\s|\d+\.\s|```.*|\|.*)/, "").replace(/[*_`#[\]]/g, "").trim())
    .filter(Boolean)
    .join(" ");
  const excerpt = text.length > 120 ? `${text.slice(0, 119)}…` : text;
  return excerpt ? `Version ${document.version} · ${excerpt}` : `Version ${document.version}`;
}

/** Words a search matches beyond the title and summary: a list's items, a recipe's ingredients. */
function blockText(block: LiveBlockRecord): string {
  if (block.type === "checklist") return (block.state.items ?? []).map((i) => i.text).join("\n");
  if (block.type === "recipe") return (block.data as RichData<"recipe">).ingredients.map((i) => i.item).join("\n");
  return "";
}

export class SavedStore {
  private readonly file: string;
  readonly artifacts: ArtifactStore;
  readonly blocks: BlockStore;

  constructor(
    stateDir: string,
    private readonly opts: { principalId?: string; notify?: Notify; now?: () => Date; artifacts?: ArtifactStore; blocks?: BlockStore } = {},
  ) {
    this.file = join(stateDir, "saved-meta.json");
    this.artifacts = opts.artifacts ?? new ArtifactStore(stateDir);
    this.blocks = opts.blocks ?? new BlockStore(stateDir);
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  /** Every item's metadata; a missing file is empty, and a link or corrupt file is refused. */
  private readMeta(): Record<string, Meta> {
    let fd: number;
    try {
      fd = openSync(this.file, SAFE_OPEN);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > META_MAX) throw new Error("Invalid saved metadata file");
      return metaFile.parse(JSON.parse(readFileSync(fd, "utf8"))).items;
    } finally {
      closeSync(fd);
    }
  }

  private writeMeta(items: Record<string, Meta>): void {
    // Drop empty entries, so the file only holds what something set.
    const kept = Object.fromEntries(Object.entries(items).filter(([, m]) => Object.keys(m).length));
    writeFileAtomic(this.file, JSON.stringify({ version: 1, items: kept }));
  }

  /** Tells open devices an item changed; they refetch what shows it. */
  announce(kind: SavedKind, id: string): void {
    if (!this.opts.notify) return;
    try {
      this.opts.notify(SAVED_CHANGED, { principalId: this.opts.principalId ?? "", kind, id });
    } catch {
      // Best effort: a device that missed it refetches on its next load.
    }
  }

  private fromBlock(block: LiveBlockRecord, meta: Meta, now: Date): SavedItemRecord {
    const endsAt = block.type === "timer" && block.state.endsAt && timerLeft(block.state, (block.data as RichData<"timer">).duration, now) > 0
      ? block.state.endsAt
      : undefined;
    return {
      kind: block.type as SavedKind,
      id: block.id,
      title: block.title || block.type,
      conversationId: block.conversationId,
      sourceMessageId: block.messageKey,
      status: blockStatus(block, meta, now),
      pinned: !!meta.pinned,
      archived: !!meta.archivedAt && !meta.pinned,
      createdAt: block.createdAt,
      updatedAt: block.updatedAt,
      updatedBy: block.updatedBy,
      summary: blockSummary(block, now).slice(0, 300),
      ...(endsAt ? { endsAt } : {}),
      ...(block.type === "checklist"
        ? { progress: { done: (block.state.items ?? []).filter((i) => i.done).length, total: (block.state.items ?? []).length } }
        : {}),
    };
  }

  private fromDocument(document: ArtifactDocument, meta: Meta, now: Date): SavedItemRecord {
    return {
      kind: "document",
      id: document.id,
      title: document.title,
      conversationId: document.conversationId,
      sourceMessageId: meta.sourceMessageId ?? null,
      status: documentStatus(document, meta, now),
      pinned: !!meta.pinned,
      archived: !!meta.archivedAt && !meta.pinned,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      updatedBy: "agent",
      summary: documentSummary(document).slice(0, 300),
    };
  }

  /** The stored item behind an id, or null: a missing document, a missing block, or a reply block. */
  private find(id: string): { kind: SavedKind; document?: ArtifactDocument; block?: LiveBlockRecord } | null {
    if (!savedId.safeParse(id).success) return null;
    if (id.includes(".")) {
      const block = this.blocks.get(id);
      return block && SAVED_BLOCK_TYPES.has(block.type) ? { kind: block.type as SavedKind, block } : null;
    }
    const document = this.artifacts.get(id);
    return document ? { kind: "document", document } : null;
  }

  get(id: string): SavedItemRecord | null {
    const found = this.find(id);
    if (!found) return null;
    const meta = this.readMeta()[id] ?? {};
    const now = this.now();
    return found.block ? this.fromBlock(found.block, meta, now) : this.fromDocument(found.document!, meta, now);
  }

  list(filter: SavedListFilter = {}): SavedResult {
    const f = savedListFilter.parse(filter);
    const now = this.now();
    const meta = this.readMeta();
    const items: SavedItemRecord[] = [];
    const seen = new Set<string>();
    const needle = f.query?.trim().toLocaleLowerCase() ?? "";
    let truncated = false;

    if (!f.kind || f.kind === "document") {
      const files = this.artifacts.documents(needle);
      truncated ||= files.truncated;
      for (const document of files.documents) {
        seen.add(document.id);
        items.push(this.fromDocument(document, meta[document.id] ?? {}, now));
      }
    }
    if (!f.kind || f.kind !== "document") {
      const scanned = this.blocks.scan();
      truncated ||= scanned.truncated;
      // Pinned blocks beyond the scan still show.
      const pinnedOutside = Object.entries(meta)
        .filter(([id, m]) => m.pinned && id.includes(".") && !scanned.blocks.some((b) => b.id === id))
        .flatMap(([id]) => {
          const block = this.blocks.get(id);
          return block ? [block] : [];
        });
      for (const block of [...scanned.blocks, ...pinnedOutside]) {
        if (!SAVED_BLOCK_TYPES.has(block.type) || seen.has(block.id)) continue;
        seen.add(block.id);
        const item = this.fromBlock(block, meta[block.id] ?? {}, now);
        if (needle && !`${item.title}\n${item.summary}\n${blockText(block)}`.toLocaleLowerCase().includes(needle)) continue;
        items.push(item);
      }
    }

    const kept = items.filter((item) =>
      (!f.kind || item.kind === f.kind) &&
      (!f.conversationId || item.conversationId === f.conversationId) &&
      (f.status === "all" || item.status === f.status) &&
      (f.pinned === undefined || item.pinned === f.pinned));
    const used = (item: SavedItemRecord) => lastUse(item.updatedAt, meta[item.id] ?? {});
    kept.sort((a, b) => Number(b.pinned) - Number(a.pinned) || used(b) - used(a) || a.id.localeCompare(b.id));
    const limit = f.limit ?? LIST_MAX;
    return { items: kept.slice(0, limit), truncated: truncated || kept.length > limit };
  }

  /** Pins, unpins, archives, restores, or records an opening. Answers the item as it now stands. */
  act(id: string, action: SavedAction): SavedItemRecord {
    const found = this.find(id);
    if (!found) throw new RpcHandlerError("This item no longer exists.", -32040);
    const all = this.readMeta();
    const before = this.get(id)!;
    const at = this.now().toISOString();
    const meta: Meta = { ...(all[id] ?? {}) };
    switch (action) {
      case "pin":
        meta.pinned = true;
        delete meta.archivedAt;
        break;
      case "unpin":
        // The idle clocks restart, so an unpinned item doesn't drop out of Active at once.
        if (meta.pinned) meta.touchedAt = at;
        delete meta.pinned;
        break;
      case "archive":
        meta.archivedAt = at;
        delete meta.pinned;
        break;
      case "restore":
        delete meta.archivedAt;
        meta.touchedAt = at;
        break;
      case "opened":
        meta.openedAt = at;
        break;
    }
    all[id] = meta;
    this.writeMeta(all);
    const after = this.get(id)!;
    // An opening is announced only when it changes what lists show.
    if (action !== "opened" || after.status !== before.status) this.announce(after.kind, id);
    return after;
  }

  /**
   * A reply was delivered: each document it links (`/artifacts/<id>`) that has no source yet takes
   * this reply as its source, so "From" links land on the reply that shared it; later replies never
   * overwrite. New saved blocks in the reply are announced so open lists show them.
   */
  recordReply(outboxId: string, text: string, newBlocks: readonly LiveBlockRecord[] = []): void {
    const ids = [...new Set([...text.matchAll(ARTIFACT_LINK_RE)].map((m) => m[1]!))];
    if (ids.length) {
      const all = this.readMeta();
      const recorded: string[] = [];
      for (const id of ids) {
        if (all[id]?.sourceMessageId || !this.artifacts.get(id)) continue;
        all[id] = { ...(all[id] ?? {}), sourceMessageId: outboxId };
        recorded.push(id);
      }
      if (recorded.length) {
        this.writeMeta(all);
        for (const id of recorded) this.announce("document", id);
      }
    }
    for (const block of newBlocks) if (SAVED_BLOCK_TYPES.has(block.type)) this.announce(block.type as SavedKind, block.id);
  }

  manage(request: SavedRequest): SavedResult {
    switch (request.action) {
      case "list": {
        const { action: _, ...filter } = request;
        return this.list(filter);
      }
      case "get": {
        const item = this.get(request.id);
        if (!item) throw new RpcHandlerError("This item no longer exists.", -32040);
        return { items: [item] };
      }
      default:
        return { items: [this.act(request.id, request.action)] };
    }
  }

  handlers(principalId: string) {
    return {
      [SAVED_MANAGE]: async (raw: unknown) => {
        const params = savedParams.parse(raw);
        if (params.principalId !== principalId) throw new RpcHandlerError("principal mismatch", -32602);
        return this.manage(params.request);
      },
    };
  }

  /** The agent's tools: find saved items across conversations, and pin, archive or restore them. */
  extension(conversationId: string): ExtensionFactory {
    return (pi) => {
      const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: {} });
      const brief = (item: SavedItemRecord) => ({
        id: item.id, kind: item.kind, title: item.title, conversationId: item.conversationId, status: item.status,
        pinned: item.pinned, archived: item.archived, summary: item.summary, updatedAt: item.updatedAt,
      });
      pi.registerTool({
        name: "list_saved_items", label: "List saved items",
        description:
          "List the owner's saved items: documents from save_artifact plus stored checklists, recipes and timers, across all conversations by default. " +
          "Each has a status (active, or done once finished or left unused) and may be pinned. Pinned come first, then most recently used. " +
          "Use it to find an item the owner names (\"the grocery list\") before update_saved_item, read_block or find_artifacts.",
        parameters: Type.Object({
          scope: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("conversation")])),
          status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("done"), Type.Literal("all")])),
          kind: Type.Optional(Type.Union([Type.Literal("document"), Type.Literal("checklist"), Type.Literal("recipe"), Type.Literal("timer")])),
          pinned: Type.Optional(Type.Boolean()),
          query: Type.Optional(Type.String({ maxLength: 200 })),
        }),
        execute: async (_id, input) => {
          const { items, truncated } = this.list({
            status: input.status ?? "all",
            ...(input.scope === "conversation" ? { conversationId } : {}),
            ...(input.kind ? { kind: input.kind } : {}),
            ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
            ...(input.query ? { query: input.query } : {}),
            limit: 30,
          });
          return result({ items: items.map(brief), ...(truncated ? { truncated } : {}) });
        },
      });
      pi.registerTool({
        name: "update_saved_item", label: "Pin or archive a saved item",
        description:
          "Pin, unpin, archive or restore a saved item by id (from list_saved_items). Pinned items stay active and show on the owner's Home; " +
          "archive marks one done (it stays findable under Done); restore brings it back. Do it when the owner asks (\"pin the grocery list\").",
        parameters: Type.Object({
          id: Type.String({ maxLength: 80 }),
          action: Type.Union([Type.Literal("pin"), Type.Literal("unpin"), Type.Literal("archive"), Type.Literal("restore")]),
        }),
        execute: async (_id, input) => {
          if (!this.find(input.id)) throw new Error(`No saved item ${input.id}. Use list_saved_items to find one.`);
          return result(brief(this.act(input.id, input.action)));
        },
      });
    };
  }
}

export const SAVED_TOOLS = ["list_saved_items", "update_saved_item"];
