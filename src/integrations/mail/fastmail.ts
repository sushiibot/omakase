import { IntegrationError, type MailProvider, type ProviderContext, type MailMessage, type DraftInput } from "./types.ts";
import { providerJson, providerFetch, bytes, MAX_ATTACHMENT, type Fetch } from "./http.ts";
const CORE = "urn:ietf:params:jmap:core";
const MAIL = "urn:ietf:params:jmap:mail";
const SESSION = "https://api.fastmail.com/jmap/session";
/** Session-provided URLs may select paths, but cannot move bearer tokens to another host. */
function endpoint(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !["api.fastmail.com", "www.fastmailusercontent.com"].includes(url.hostname) || url.port || url.username || url.password) throw new IntegrationError("Fastmail returned an unsupported API address.");
  return url.href;
}
const addresses = (list: any[]) => (list ?? []).map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(", ");
function message(raw: any): MailMessage {
  return { id: raw.id, threadId: raw.threadId, subject: raw.subject ?? "", from: addresses(raw.from), to: addresses(raw.to), date: raw.receivedAt ?? "", preview: raw.preview ?? "", labels: Object.keys(raw.mailboxIds ?? {}), attachments: (raw.attachments ?? []).map((a: any) => ({ id: a.blobId, name: a.name ?? "attachment", type: a.type ?? "application/octet-stream", size: a.size ?? 0 })), messageId: raw.messageId?.[0] ? `<${raw.messageId[0]}>` : undefined, ...(raw.bodyValues ? { body: (raw.textBody?.length ? raw.textBody : raw.htmlBody ?? []).map((p: any) => raw.bodyValues[p.partId]?.value ?? "").join("\n").slice(0, 100_000) } : {}) };
}
export class FastmailProvider implements MailProvider {
  readonly id = "fastmail"; readonly name = "Fastmail"; readonly auth = "token"; readonly configured = true;
  readonly setupHelp = "Create a JMAP token in Fastmail’s Privacy & Security settings with mail read/write access. Leave sending access off. The token stays on the gateway.";
  constructor(private fetcher: Fetch = fetch) {}
  private session(token: string) { return providerJson(this.fetcher, SESSION, { headers: { Authorization: `Bearer ${token}` } }); }
  private async call(token: string, session: any, method: string, args: Record<string, unknown>): Promise<any> {
    const result = await providerJson(this.fetcher, endpoint(session.apiUrl), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ using: [CORE, MAIL], methodCalls: [[method, args, "mail"]] }) });
    const response = result.methodResponses?.find((r: any[]) => r[2] === "mail");
    if (!response || response[0] !== method) throw new IntegrationError("Fastmail could not complete this mail operation. Check the account permissions.");
    return response[1];
  }
  async identity(token: string) {
    const session = await this.session(token); const remoteId = session.primaryAccounts?.[MAIL];
    if (!remoteId || !session.username?.includes("@")) throw new IntegrationError("This token does not provide access to a Fastmail mailbox.");
    return { email: session.username as string, remoteId: remoteId as string };
  }
  private async emails(ctx: ProviderContext, session: any, ids: string[], full = false) {
    return this.call(ctx.token, session, "Email/get", { accountId: ctx.identity.remoteId, ids, properties: ["id", "threadId", "mailboxIds", "keywords", "subject", "from", "to", "receivedAt", "preview", "attachments", "messageId", ...(full ? ["textBody", "htmlBody", "bodyValues"] : [])], ...(full ? { fetchTextBodyValues: true, fetchHTMLBodyValues: true, maxBodyValueBytes: 100_000 } : {}) });
  }
  async search(ctx: ProviderContext, input: Parameters<MailProvider["search"]>[1]) {
    const position = Number(input.cursor ?? 0);
    if (!Number.isSafeInteger(position) || position < 0) throw new IntegrationError("Invalid mail page cursor.");
    const session = await this.session(ctx.token);
    const query = await this.call(ctx.token, session, "Email/query", { accountId: ctx.identity.remoteId, filter: input.query ? { text: input.query } : {}, sort: [{ property: "receivedAt", isAscending: false }], position, limit: input.limit });
    const result = await this.emails(ctx, session, query.ids ?? []);
    return { messages: (result.list ?? []).map(message), ...(query.ids?.length === input.limit ? { cursor: String(position + input.limit) } : {}) };
  }
  async read(ctx: ProviderContext, id: string) {
    const result = await this.emails(ctx, await this.session(ctx.token), [id], true);
    if (!result.list?.[0]) throw new IntegrationError("This message is no longer available.", 404);
    return message(result.list[0]);
  }
  async attachment(ctx: ProviderContext, id: string, attachmentId: string) {
    const mail = await this.read(ctx, id); const a = mail.attachments.find(item => item.id === attachmentId);
    if (!a || a.size > MAX_ATTACHMENT) throw new IntegrationError("Attachment unavailable or larger than 1 MB. Open it in Fastmail.");
    const session = await this.session(ctx.token);
    const url = String(session.downloadUrl).replace("{accountId}", encodeURIComponent(ctx.identity.remoteId)).replace("{blobId}", encodeURIComponent(a.id)).replace("{name}", encodeURIComponent(a.name)).replace("{type}", encodeURIComponent(a.type));
    const response = await providerFetch(this.fetcher, endpoint(url), { headers: { Authorization: `Bearer ${ctx.token}` } });
    return { name: a.name, type: a.type, data: (await bytes(response, MAX_ATTACHMENT)).toString("base64") };
  }
  async saveDraft(ctx: ProviderContext, input: DraftInput) {
    const session = await this.session(ctx.token); const accountId = ctx.identity.remoteId;
    let state: string | undefined;
    if (input.draftId) {
      const current = await this.emails(ctx, session, [input.draftId]);
      if (!current.list?.[0]?.keywords?.$draft) throw new IntegrationError("This message is no longer a draft. Open Fastmail to check it.");
      state = current.state;
    }
    const boxes = await this.call(ctx.token, session, "Mailbox/get", { accountId, properties: ["id", "role"] });
    const drafts = boxes.list?.find((b: any) => b.role === "drafts");
    if (!drafts) throw new IntegrationError("Fastmail has no Drafts mailbox.");
    const attachments = [];
    for (const a of input.attachments) {
      const url = endpoint(String(session.uploadUrl).replace("{accountId}", encodeURIComponent(accountId)));
      const blob = await providerJson(this.fetcher, url, { method: "POST", headers: { Authorization: `Bearer ${ctx.token}`, "Content-Type": a.type }, body: Buffer.from(a.data, "base64") });
      if (!blob.blobId) throw new IntegrationError("Fastmail did not confirm the attachment upload.");
      attachments.push({ blobId: blob.blobId, type: a.type, name: a.name, disposition: "attachment" });
    }
    const reply = input.replyToMessageId ? await this.read(ctx, input.replyToMessageId) : undefined;
    const replyId = reply?.messageId?.slice(1, -1);
    const email = { mailboxIds: { [drafts.id]: true }, keywords: { $draft: true }, from: [{ email: ctx.identity.email }], to: input.to.map(email => ({ email })), cc: input.cc.map(email => ({ email })), bcc: input.bcc.map(email => ({ email })), subject: input.subject, textBody: [{ partId: "body", type: "text/plain" }], bodyValues: { body: { value: input.body } }, attachments, ...(replyId ? { inReplyTo: [replyId], references: [replyId] } : {}) };
    // JMAP message content is immutable: replacing an app-owned draft creates a new Email and destroys the old one.
    // ifInState prevents replacement when the mailbox changed since we checked the old draft.
    const result = await this.call(ctx.token, session, "Email/set", { accountId, ...(state ? { ifInState: state } : {}), create: { draft: email } });
    const created = result.created?.draft;
    if (!created?.id) throw new IntegrationError("Fastmail did not save the draft. Check Drafts before trying again.");
    // Only remove the old draft after successful creation; a failed cleanup must never hide the new draft.
    if (input.draftId) {
      try { await this.call(ctx.token, session, "Email/set", { accountId, ifInState: result.newState, destroy: [input.draftId] }); } catch { /* the old draft remains; no mail is sent */ }
    }
    return { id: created.id as string, messageId: created.id as string, threadId: created.threadId as string | undefined };
  }
}
