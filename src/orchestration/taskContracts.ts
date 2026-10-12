import { z } from "zod";

export const TASKS_MANAGE = "tasks/manage";
export const taskId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
export const taskStatus = z.enum([
  "todo",
  "in-progress",
  "needs-you",
  "done",
  "cancelled",
]);
export const checklistItem = z
  .object({
    id: taskId,
    title: z.string().trim().min(1).max(300),
    done: z.boolean(),
  })
  .strict();
export const taskRecord = z
  .object({
    id: taskId,
    title: z.string().trim().min(1).max(200),
    brief: z.string().max(16000),
    status: taskStatus,
    checklist: z.array(checklistItem).max(100),
    sourceConversationId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    workConversationId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,80}$/)
      .optional(),
    parentTaskId: taskId.optional(),
    agent: z.string().max(100).optional(),
    runIds: z.array(z.string().max(80)).max(100),
    result: z.string().max(4000).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    revision: z.number().int().positive(),
    legacyKey: z.string().max(200).optional(),
  })
  .strict();
export type TaskRecord = z.infer<typeof taskRecord>;
export const taskPatch = taskRecord
  .pick({ title: true, brief: true, status: true, checklist: true })
  .partial()
  .strict();
export const taskRequest = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("list"),
      conversationId: z.string().max(80).optional(),
    })
    .strict(),
  z.object({ action: z.literal("get"), id: taskId }).strict(),
  z
    .object({
      action: z.literal("create"),
      title: taskRecord.shape.title,
      brief: taskRecord.shape.brief.optional(),
      conversationId: taskRecord.shape.sourceConversationId.optional(),
      parentTaskId: taskId.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("update"),
      id: taskId,
      revision: z.number().int().positive(),
      patch: taskPatch,
    })
    .strict(),
  z
    .object({
      action: z.literal("bind"),
      id: taskId,
      conversationId: taskRecord.shape.sourceConversationId,
    })
    .strict(),
]);
export type TaskRequest = z.infer<typeof taskRequest>;
export const tasksParams = z
  .object({ principalId: z.string(), request: taskRequest })
  .strict();
export const tasksResult = z
  .object({ tasks: z.array(taskRecord).max(2000) })
  .strict();
export const taskAction = z.discriminatedUnion("action", [
  taskRequest.options[0],
  taskRequest.options[1],
  taskRequest.options[2],
  taskRequest.options[3],
  z.object({ action: z.literal("prepare"), id: taskId }).strict(),
  z
    .object({
      action: z.literal("start"),
      id: taskId,
      text: z.string().trim().min(1).max(16000).optional(),
    })
    .strict(),
  z.object({ action: z.literal("stop"), id: taskId }).strict(),
]);
