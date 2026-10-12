import { z } from "zod";
export const machineId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const provider = z.enum(["codex", "claude"]);
export const execution = z
  .object({ machineId, rootId: machineId, provider, sessionId: machineId })
  .strict();
export type Execution = z.infer<typeof execution>;
export const machineInfo = z
  .object({
    name: z.string().min(1).max(100),
    roots: z
      .array(
        z
          .object({
            id: machineId,
            name: z.string().max(100),
            coding: z.boolean(),
          })
          .strict(),
      )
      .max(32),
    providers: z.array(provider).max(2),
  })
  .strict();
export const fileRequest = z
  .object({
    action: z.enum(["list", "read", "search"]),
    machineId,
    rootId: machineId,
    path: z.string().max(2000).default("."),
    query: z.string().min(1).max(200).optional(),
    offset: z.number().int().min(0).max(10000000).default(0),
  })
  .strict();
export const sessionRequest = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("start"),
      sessionId: machineId,
      taskId: z.string().max(80),
      rootId: machineId,
      provider,
      text: z.string().trim().min(1).max(60000),
    })
    .strict(),
  z
    .object({
      action: z.literal("prompt"),
      sessionId: machineId,
      text: z.string().trim().min(1).max(60000),
      requestId: machineId,
    })
    .strict(),
  z.object({ action: z.literal("get"), sessionId: machineId }).strict(),
  z.object({ action: z.literal("stop"), sessionId: machineId }).strict(),
  z
    .object({
      action: z.literal("answer"),
      sessionId: machineId,
      requestId: z.union([z.string().max(200), z.number()]),
      decision: z.enum(["accept", "decline"]),
    })
    .strict(),
]);
export const sessionRecord = z
  .object({
    id: machineId,
    taskId: z.string().max(80),
    rootId: machineId,
    provider,
    threadId: z.string().max(200).optional(),
    status: z.enum([
      "running",
      "needs-you",
      "completed",
      "failed",
      "stopped",
      "interrupted",
    ]),
    output: z.string().max(64000),
    error: z.string().max(1000).optional(),
    updatedAt: z.string(),
    attempts: z.number().int().min(1),
    requests: z
      .array(
        z.object({
          id: z.union([z.string().max(200), z.number()]),
          method: z.string().max(200),
          description: z.string().max(2000),
        }),
      )
      .max(20),
    promptIds: z.array(machineId).max(100),
  })
  .strict();
export type SessionRecord = z.infer<typeof sessionRecord>;
