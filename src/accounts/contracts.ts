import { z } from "zod/v4";
import type { ToolManifestEntry } from "../orchestration/contracts.ts";
export const passwordPolicy = z
  .object({
    minLength: z.number().int().min(12).max(128).optional(),
    maxLength: z.number().int().min(12).max(128).optional(),
    requireUppercase: z.boolean().optional(),
    requireLowercase: z.boolean().optional(),
    requireDigits: z.boolean().optional(),
    requireSymbols: z.boolean().optional(),
    allowedSymbols: z
      .string()
      .max(64)
      .regex(/^[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]*$/)
      .optional(),
  })
  .strict();
export type PasswordPolicy = z.infer<typeof passwordPolicy>;
export const accountMetadata = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    origin: z.string(),
    username: z.string(),
    status: z.enum(["pending", "active", "archived"]),
    version: z.number().int().positive(),
    confirmedVersion: z.number().int().positive().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export type AccountMetadata = z.infer<typeof accountMetadata>;
export interface AuditEvent {
  id: string;
  accountId: string;
  version?: number;
  action: string;
  actor: string;
  at: number;
  origin?: string;
  engine?: string;
  runId?: string;
  outcome?: string;
}
const identity = {
  accountId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
};
const requestId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/);
export const accountRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }).strict(),
  z
    .object({
      action: z.literal("prepare"),
      name: z.string().trim().min(1).max(160),
      origin: z.string().max(2048),
      username: z.string().trim().min(1).max(320),
      passwordPolicy: passwordPolicy.optional(),
      requestId,
    })
    .strict(),
  z
    .object({
      action: z.literal("revise"),
      ...identity,
      passwordPolicy,
      requestId,
    })
    .strict(),
  z.object({ action: z.literal("confirm"), ...identity }).strict(),
  z.object({ action: z.literal("archive"), ...identity }).strict(),
]);
export const internalRequest = z.discriminatedUnion("operation", [
  z
    .object({
      principalId: z.string(),
      operation: z.literal("fill"),
      accountId: z.string().uuid(),
      version: z.number().int().positive().optional(),
      origin: z.string().max(2048),
      engine: z.enum(["chromium", "camoufox"]),
      runId: z.string().max(256).optional(),
    })
    .strict(),
  z
    .object({
      principalId: z.string(),
      operation: z.literal("fill_result"),
      receiptId: z.string().uuid(),
      outcome: z.enum(["filled", "failed"]),
    })
    .strict(),
  z
    .object({
      principalId: z.string(),
      operation: z.literal("redact"),
      payload: z.unknown(),
      runId: z.string().max(256).optional(),
      provider: z.string().max(128).optional(),
    })
    .strict(),
]);
export const accountsManifest: ToolManifestEntry = {
  name: "accounts",
  description:
    "Manage generated website credentials without reading passwords. Prepare a candidate for an authorized account; fill it with the browser account reference. Confirm only after the website accepts it. Revise on rejection with its password policy; preserve the requestId only for identical retries. Archive unused accounts. Passwords are available only to owner reveal/copy and secure browser fill. Never ask the owner to paste a password.",
  inputSchema: z.toJSONSchema(accountRequest, {
    io: "input",
    target: "draft-7",
  }),
  approval: "none",
};
