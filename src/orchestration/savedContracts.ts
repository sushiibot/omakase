import { z } from "zod";
import { TOPIC_ID_RE } from "./contracts.ts";

/** Saved items: one view over the agent-made things the owner comes back to, the documents
 *  (artifacts) and the stored checklists, recipes and timers (live blocks). Each carries where it
 *  came from (conversation and source message), whether it is still in use (active or done, by
 *  fixed rules), and one manual signal, pin. The wire shapes match `SavedItem` in
 *  web/src/lib/features/saved/types.ts. */

export const SAVED_MANAGE = "saved/manage";
/** Workspace → gateway notification: a saved item's pin, archive or provenance changed, or a
 *  document was saved. Block changes travel as blocks/changed. */
export const SAVED_CHANGED = "saved/changed";

export const SAVED_KINDS = ["document", "checklist", "recipe", "timer"] as const;
export const savedKind = z.enum(SAVED_KINDS);
export type SavedKind = z.infer<typeof savedKind>;

/** A document id (uuid) or a live block id (`<reply key>.<n>`). */
export const savedId = z.string().regex(/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9A-Za-z_-]{8,64}\.\d{1,2})$/);
const at = z.string().datetime({ offset: true });

export const savedItem = z.object({
  kind: savedKind,
  id: savedId,
  title: z.string().max(200),
  conversationId: z.string().max(256),
  /** The reply the item came from (its outbox key), for a `?m=` link; null when unknown. */
  sourceMessageId: z.string().max(64).nullable(),
  status: z.enum(["active", "done"]),
  pinned: z.boolean(),
  /** Archived by the owner or the agent: done whatever the rules say, until restored. */
  archived: z.boolean(),
  createdAt: at,
  updatedAt: at,
  updatedBy: z.enum(["owner", "agent"]),
  /** One line of current state, such as "3 of 7 done". */
  summary: z.string().max(300),
  /** A running timer's end, so a screen can count down without refetching. */
  endsAt: at.optional(),
  /** A checklist's ticked and total items. */
  progress: z.object({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() }).optional(),
});
export type SavedItemRecord = z.infer<typeof savedItem>;

export const savedListFilter = z.object({
  conversationId: z.string().regex(TOPIC_ID_RE).optional(),
  status: z.enum(["active", "done", "all"]).default("active"),
  kind: savedKind.optional(),
  pinned: z.boolean().optional(),
  query: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(500).optional(),
}).strict();
export type SavedListFilter = z.input<typeof savedListFilter>;

export const SAVED_ACTIONS = ["pin", "unpin", "archive", "restore", "opened"] as const;
export const savedAction = z.enum(SAVED_ACTIONS);
export type SavedAction = z.infer<typeof savedAction>;

const idAction = <A extends string>(action: A) => z.object({ action: z.literal(action), id: savedId }).strict();
export const savedRequest = z.discriminatedUnion("action", [
  savedListFilter.extend({ action: z.literal("list") }).strict(),
  idAction("get"),
  idAction("pin"),
  idAction("unpin"),
  idAction("archive"),
  idAction("restore"),
  idAction("opened"),
]);
export type SavedRequest = z.input<typeof savedRequest>;

export const savedParams = z.object({ principalId: z.string(), request: savedRequest }).strict();
export const savedResult = z.object({ items: z.array(savedItem), truncated: z.boolean().optional() });
export type SavedResult = z.infer<typeof savedResult>;

export const savedChangedParams = z.object({ principalId: z.string(), kind: savedKind, id: savedId });
export type SavedChangedParams = z.infer<typeof savedChangedParams>;
