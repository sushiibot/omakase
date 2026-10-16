import { z } from "zod";

export const MAINTENANCE = "maintenance/manage";
const text = z.string().min(1).max(2000);
export const maintenancePrepare = z.object({
  serverId: z.string().uuid(), eventId: z.string().min(1).max(512),
  after: z.string().min(10).max(40), before: z.string().min(10).max(40),
  emailId: z.string().min(1).max(512),
  reason: text,
  excerpts: z.array(z.string().trim().min(1).max(1500)).min(1).max(8),
}).strict();
export const maintenanceProposal = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(), key: z.string(),
  status: z.enum(["pending", "dismissed", "superseded", "executing", "completed", "conflict", "uncertain", "undoing", "undone"]),
  createdAt: z.string(), updatedAt: z.string(), expiresAt: z.string(),
  input: maintenancePrepare, binding: z.string(),
  eventTitle: z.string(), eventStart: z.string(), eventTimeZone: z.string().nullable(),
  emailSubject: z.string(), emailReceivedAt: z.string(),
  before: z.string(), after: z.string(), eventHash: z.string(), sourceHash: z.string(),
  operation: z.enum(["update", "undo"]).optional(),
  afterHash: z.string().optional(), message: z.string().optional(),
  decidedAt: z.string().optional(), completedAt: z.string().optional(),
});
export type MaintenanceProposal = z.infer<typeof maintenanceProposal>;
export const maintenanceView = z.object({
  responsibility: z.object({
    title: z.string(), enabled: z.boolean(), lastReadAt: z.string().nullable(),
    lastReviewAt: z.string().nullable(), lastError: z.string().nullable(),
  }),
  proposals: z.array(maintenanceProposal),
});
export const maintenanceRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }).strict(),
  z.object({ action: z.literal("pause"), paused: z.boolean() }).strict(),
  z.object({ action: z.enum(["approve", "dismiss", "undo", "reconcile"]), id: z.string().uuid(), revision: z.number().int().positive() }).strict(),
]);
export type MaintenanceRequest = z.infer<typeof maintenanceRequest>;
export const maintenanceParams = z.object({ principalId: z.string(), request: maintenanceRequest });
export const maintenanceResult = z.object({ view: maintenanceView, error: z.string().optional() });
