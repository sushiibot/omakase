import { createHash } from "node:crypto";
import { IntegrationError, type MailProvider, type Credential, type OAuthConfig, type ProviderContext, type MailMessage, type DraftInput } from "./types.ts";
import { providerJson, providerFetch, MAX_ATTACHMENT, type Fetch } from "./http.ts";
import { draftMime } from "./mime.ts";
const ROOT = "https://gmail.googleapis.com/gmail/v1/users/me";
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"];
const enc = encodeURIComponent;
function header(message: any, name: string): string { return message.payload?.headers?.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ""; }
function message(raw: any, full = false): MailMessage {
  const attachments: MailMessage["attachments"] = []; const text: string[] = []; const html: string[] = [];
  function visit(part: any) {
    if (part.filename && part.body?.attachmentId) attachments.push({ id: part.body.attachmentId, name: part.filename, type: part.mimeType, size: part.body.size ?? 0 });
    else if (part.body?.data && part.mimeType === "text/plain") text.push(Buffer.from(part.body.data, "base64url").toString("utf8"));
    else if (part.body?.data && part.mimeType === "text/html") html.push(Buffer.from(part.body.data, "base64url").toString("utf8"));
    for (const child of part.parts ?? []) visit(child);
  }
  if (raw.payload) visit(raw.payload);
  return { id: raw.id, threadId: raw.threadId, subject: header(raw, "subject"), from: header(raw, "from"), to: header(raw, "to"), date: header(raw, "date"), preview: raw.snippet ?? "", labels: raw.labelIds ?? [], attachments, messageId: header(raw, "message-id"), ...(full ? { body: (text.length ? text : html).join("\n").slice(0, 100_000) } : {}) };
}
export class GmailProvider implements MailProvider {
  readonly id = "gmail"; readonly name = "Google Gmail"; readonly auth = "oauth";
  readonly configured: boolean;
  readonly connectLabel = "Continue with Google";
  readonly setupHelp = "Sign in with Google, including your usual two-factor authentication. Google bundles draft access with sending permission; this integration only exposes reading and saving drafts.";
  constructor(private config?: OAuthConfig, private fetcher: Fetch = fetch) { this.configured = !!config; }
  private oauth() { if (!this.config) throw new IntegrationError("Google sign-in is not configured on the gateway."); return this.config; }
  authorizationUrl(state: string, verifier: string) {
    const c = this.oauth(); const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: c.clientId, redirect_uri: c.redirectUri, response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent select_account", state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
    return url.href;
  }
  private async token(fields: Record<string, string>): Promise<Credential> {
    const c = this.oauth();
    const result = await providerJson(this.fetcher, "https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...fields }) });
    if (!result.access_token || (result.scope && SCOPES.some(s => !result.scope.split(" ").includes(s)))) throw new IntegrationError("Google did not grant the required mail permissions. Reconnect and approve both permissions.");
    return { accessToken: result.access_token, ...(result.refresh_token ? { refreshToken: result.refresh_token } : {}), expiresAt: Date.now() + Number(result.expires_in ?? 3600) * 1000 };
  }
  async exchange(code: string, verifier: string) {
    const credential = await this.token({ code, code_verifier: verifier, redirect_uri: this.oauth().redirectUri, grant_type: "authorization_code" });
    if (!credential.refreshToken) throw new IntegrationError("Google did not grant background access. Remove this app in Google account permissions and connect again.");
    return credential;
  }
  async refresh(credential: Credential) {
    if (!credential.refreshToken) throw new IntegrationError("Reconnect this Google account.", 401);
    return { ...credential, ...await this.token({ refresh_token: credential.refreshToken, grant_type: "refresh_token" }) };
  }
  async revoke(credential: Credential) { await providerFetch(this.fetcher, "https://oauth2.googleapis.com/revoke", { method: "POST", body: new URLSearchParams({ token: credential.refreshToken ?? credential.accessToken }) }); }
  private get(token: string, path: string) { return providerJson(this.fetcher, ROOT + path, { headers: { Authorization: `Bearer ${token}` } }); }
  async identity(token: string) { const p = await this.get(token, "/profile"); if (!p.emailAddress) throw new IntegrationError("Google did not return an account address."); return { email: p.emailAddress as string, remoteId: p.emailAddress as string }; }
  async search(ctx: ProviderContext, input: Parameters<MailProvider["search"]>[1]) {
    const q = new URLSearchParams({ q: input.query, maxResults: String(input.limit), ...(input.cursor ? { pageToken: input.cursor } : {}) });
    const result = await this.get(ctx.token, `/messages?${q}`);
    const messages = await Promise.all((result.messages ?? []).map(async (m: any) => message(await this.get(ctx.token, `/messages/${enc(m.id)}?format=metadata`))));
    return { messages, ...(result.nextPageToken ? { cursor: result.nextPageToken } : {}) };
  }
  async read(ctx: ProviderContext, id: string) { return message(await this.get(ctx.token, `/messages/${enc(id)}?format=full`), true); }
  async attachment(ctx: ProviderContext, id: string, attachmentId: string) {
    const mail = await this.read(ctx, id); const attachment = mail.attachments.find(a => a.id === attachmentId);
    if (!attachment || attachment.size > MAX_ATTACHMENT) throw new IntegrationError("Attachment unavailable or larger than 1 MB. Open it in Gmail.");
    const raw = await this.get(ctx.token, `/messages/${enc(id)}/attachments/${enc(attachmentId)}`);
    const data = Buffer.from(raw.data ?? "", "base64url");
    if (data.length > MAX_ATTACHMENT) throw new IntegrationError("Attachment is larger than 1 MB. Open it in Gmail.");
    return { name: attachment.name, type: attachment.type, data: data.toString("base64") };
  }
  async saveDraft(ctx: ProviderContext, input: DraftInput) {
    if (input.draftId) {
      const current = await this.get(ctx.token, `/drafts/${enc(input.draftId)}?format=minimal`);
      if (!current.message?.labelIds?.includes("DRAFT")) throw new IntegrationError("This draft is no longer editable. Open Gmail to check it.");
    }
    const reply = input.replyToMessageId ? await this.read(ctx, input.replyToMessageId) : undefined;
    const raw = Buffer.from(draftMime(ctx.identity.email, input, reply?.messageId)).toString("base64url");
    // The only write endpoints in this adapter are draft creation and replacement. Never accept a caller-supplied path/method.
    const draft = await providerJson(this.fetcher, ROOT + `/drafts${input.draftId ? `/${enc(input.draftId)}` : ""}`, { method: input.draftId ? "PUT" : "POST", headers: { Authorization: `Bearer ${ctx.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ message: { raw, ...(reply?.threadId ? { threadId: reply.threadId } : {}) } }) });
    if (!draft.id || !draft.message?.id) throw new IntegrationError("Google did not confirm the draft. Check Gmail before trying again.", 502);
    return { id: draft.id as string, messageId: draft.message.id as string, threadId: draft.message.threadId as string | undefined };
  }
}
