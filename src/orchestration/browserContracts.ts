import { z } from "zod";
import { TOPIC_ID_RE } from "./contracts.ts";

export const BROWSER_READ = "browser/read";
export const BROWSER_CONTROL = "browser/control";
export const browserEngine = z.enum(["chromium", "camoufox"]);
export type BrowserEngine = z.infer<typeof browserEngine>;
export const browserInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), x: z.number().min(0).max(4096), y: z.number().min(0).max(4096) }).strict(),
  z.object({ kind: z.literal("text"), text: z.string().min(1).max(4096) }).strict(),
  z.object({ kind: z.literal("key"), key: z.enum(["Tab", "Shift+Tab", "Enter", "Backspace", "Delete", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Control+a", "Space"]) }).strict(),
  z.object({ kind: z.literal("scroll"), direction: z.enum(["up", "down"]) }).strict(),
]);
export type BrowserInput = z.infer<typeof browserInput>;
export const browserControlRequest = z.object({
  conversationId: z.string().regex(TOPIC_ID_RE), id: z.string().regex(/^sushii-[a-f0-9-]{36}$/),
  action: z.enum(["takeover", "resume", "input"]), input: browserInput.optional(),
}).strict().refine(q => (q.action === "input") === !!q.input, "Input is required only for input actions");
export const browserControlParams = z.object({ principalId: z.string(), request: browserControlRequest }).strict();
export type BrowserControlRequest = z.infer<typeof browserControlRequest>;
export const BROWSER_FRAME_MAX = 512 * 1024;
export const browserReadParams = z.object({
  principalId: z.string(), conversationId: z.string().regex(TOPIC_ID_RE),
  frames: z.boolean().default(false),
}).strict();
export const browserStatus = z.object({
  id: z.string().max(100), conversationId: z.string().regex(TOPIC_ID_RE),
  state: z.enum(["starting", "active", "ended"]),
  engine: browserEngine.optional(), profile: z.enum(["owner", "temporary"]).optional(),
  control: z.enum(["agent", "owner"]).optional(),
  runId: z.string().max(100).nullable(),
  url: z.string().max(4096).optional(),
  action: z.string().max(100), endedAt: z.number().optional(),
}).strict();
export const browserFrame = z.object({
  seq: z.number().int().nonnegative(), data: z.string().max(BROWSER_FRAME_MAX).regex(/^[A-Za-z0-9+/]*={0,2}$/),
  width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096),
  capturedAt: z.number(),
}).strict();
export const browserReadResult = z.object({ status: browserStatus.nullable(), frame: browserFrame.optional() }).strict();
export type BrowserStatus = z.infer<typeof browserStatus>;
export type BrowserFrame = z.infer<typeof browserFrame>;
export type BrowserReadResult = z.infer<typeof browserReadResult>;
