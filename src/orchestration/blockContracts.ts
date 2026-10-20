import { z } from "zod";
import { TOPIC_ID_RE } from "./contracts.ts";

/** Live blocks: stateful rich blocks in replies (checklist, recipe, timer, actions, choice, form),
 *  stored in the workspace so the owner and the agent both read and change them. The wire shapes
 *  match `LiveBlock` in web/src/lib/core/realtime/events.ts. */

export const BLOCKS_MANAGE = "blocks/manage";
/** Workspace → gateway notification: a block changed. */
export const BLOCKS_CHANGED = "blocks/changed";

export const messageKey = z.string().regex(/^[0-9A-Za-z_-]{8,64}$/);
export const liveBlockId = z.string().regex(/^[0-9A-Za-z_-]{8,64}\.\d{1,2}$/);
export const liveBlockType = z.enum(["checklist", "recipe", "timer", "actions", "choice", "form"]);

const at = z.string().datetime({ offset: true });
const actor = z.enum(["owner", "agent"]);

export const liveBlockState = z
  .object({
    items: z.array(z.object({ id: z.number().int().nonnegative(), text: z.string().max(200), done: z.boolean() })).max(100).optional(),
    nextItem: z.number().int().nonnegative().optional(),
    serves: z.number().int().min(1).max(100).optional(),
    got: z.array(z.number().int().nonnegative()).max(100).optional(),
    endsAt: at.nullable().optional(),
    left: z.number().int().nonnegative().optional(),
    sent: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const liveBlock = z.object({
  id: liveBlockId,
  messageKey,
  index: z.number().int().nonnegative().max(99),
  conversationId: z.string().regex(TOPIC_ID_RE),
  type: liveBlockType,
  title: z.string().max(200),
  fingerprint: z.string().regex(/^[0-9a-f]{8}$/),
  data: z.unknown(),
  state: liveBlockState,
  revision: z.number().int().positive(),
  createdAt: at,
  updatedAt: at,
  updatedBy: actor,
  changes: z.array(z.object({ at, by: actor, summary: z.string().max(200) })).max(20),
});
export type LiveBlockRecord = z.infer<typeof liveBlock>;

const item = z.number().int().nonnegative();
const text = z.string().min(1).max(200);
export const liveBlockOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("check"), item, done: z.boolean() }).strict(),
  z.object({ op: z.literal("add"), text }).strict(),
  z.object({ op: z.literal("edit"), item, text }).strict(),
  z.object({ op: z.literal("remove"), item }).strict(),
  z.object({ op: z.literal("serves"), n: z.number().int().min(1).max(100) }).strict(),
  z.object({ op: z.literal("got"), item, done: z.boolean() }).strict(),
  z.object({ op: z.literal("start") }).strict(),
  z.object({ op: z.literal("pause") }).strict(),
  z.object({ op: z.literal("reset") }).strict(),
  z.object({ op: z.literal("duration"), seconds: z.number().int().min(1).max(86_400) }).strict(),
  z.object({ op: z.literal("sent"), text: z.string().min(1).max(2000) }).strict(),
]);
export type LiveBlockOpWire = z.infer<typeof liveBlockOp>;

export const blockRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), messageKeys: z.array(messageKey).min(1).max(50) }).strict(),
  z.object({ action: z.literal("get"), id: liveBlockId }).strict(),
  z.object({ action: z.literal("apply"), id: liveBlockId, ops: z.array(liveBlockOp).min(1).max(20) }).strict(),
]);
export type BlockRequest = z.infer<typeof blockRequest>;

export const blocksParams = z.object({ principalId: z.string(), request: blockRequest }).strict();
export const blocksResult = z.object({ blocks: z.array(liveBlock) });
export type BlocksResult = z.infer<typeof blocksResult>;

export const blocksChangedParams = z.object({ principalId: z.string(), block: liveBlock });
export type BlocksChangedParams = z.infer<typeof blocksChangedParams>;
