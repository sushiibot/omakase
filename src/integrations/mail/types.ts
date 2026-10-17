import { z } from "zod/v4";

export class IntegrationError extends Error {
  constructor(message: string, public readonly status = 422) { super(message); }
}
export type Credential = { accessToken: string; refreshToken?: string; expiresAt?: number };
export type MailAccount = {
  id: string; provider: string; email: string; name: string; purpose: string;
  status: "connected" | "needs-attention"; problem?: string;
};
export type Identity = { email: string; remoteId: string };
export type MailMessage = {
  id: string; threadId?: string; subject: string; from: string; to: string; date: string;
  preview: string; body?: string; labels: string[];
  attachments: { id: string; name: string; type: string; size: number }[];
  messageId?: string;
};
export type SavedDraft = { id: string; messageId: string; threadId?: string };
const id = z.string().min(1).max(512).regex(/^[A-Za-z0-9_\-.]+$/);
const email = z.string().email().max(254);
export const accountInput = z.object({ name: z.string().trim().min(1).max(100), purpose: z.string().trim().max(500).default("") }).strict();
export const searchInput = z.object({ accountId: z.string().uuid(), query: z.string().max(2000), limit: z.number().int().min(1).max(25).default(10), cursor: z.string().max(2048).optional() }).strict();
export const readInput = z.object({ accountId: z.string().uuid(), messageId: id }).strict();
export const attachmentInput = readInput.extend({ attachmentId: id }).strict();
export const draftInput = z.object({
  accountId: z.string().uuid(), requestId: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/),
  draftId: id.optional(), replyToMessageId: id.optional(),
  to: z.array(email).min(1).max(50), cc: z.array(email).max(50).default([]), bcc: z.array(email).max(50).default([]),
  subject: z.string().max(500).regex(/^[^\r\n\0]*$/), body: z.string().max(100_000),
  attachments: z.array(z.object({ name: z.string().min(1).max(150).regex(/^[^\r\n\0"\\/]+$/), type: z.string().max(100).regex(/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/), data: z.string().max(350_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).strict()).max(4).default([]),
}).strict();
export type DraftInput = z.infer<typeof draftInput>;
export type ProviderContext = { token: string; identity: Identity };
export type OAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };
export interface MailProvider {
  id: string;
  name: string;
  auth: "oauth" | "token";
  configured: boolean;
  setupHelp?: string;
  connectLabel?: string;
  identity(token: string): Promise<Identity>;
  search(ctx: ProviderContext, input: z.infer<typeof searchInput>): Promise<{ messages: MailMessage[]; cursor?: string }>;
  read(ctx: ProviderContext, messageId: string): Promise<MailMessage>;
  attachment(ctx: ProviderContext, messageId: string, attachmentId: string): Promise<{ name: string; type: string; data: string }>;
  saveDraft(ctx: ProviderContext, input: DraftInput): Promise<SavedDraft>;
  authorizationUrl?(state: string, verifier: string): string;
  exchange?(code: string, verifier: string): Promise<Credential>;
  refresh?(credential: Credential): Promise<Credential>;
  revoke?(credential: Credential): Promise<void>;
}
