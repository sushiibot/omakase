import { z } from "zod";

export const artifactId = z.string().uuid();
export const artifactSummary = z.object({
  id: artifactId,
  title: z.string().min(1).max(200),
  updatedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  conversationId: z.string().max(256),
  version: z.number().int().positive(),
});
export const artifactDocument = artifactSummary.extend({ content: z.string().max(256 * 1024) });
export const artifactReadParams = z.object({ principalId: z.string(), id: artifactId.optional(), query: z.string().max(200).optional() });
export const artifactList = z.object({ artifacts: z.array(artifactSummary), truncated: z.boolean() });
