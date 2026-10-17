import { expect, test } from "bun:test";
import { MemoryJsonState } from "../../db/jsonState.ts";
import { MailService } from "./service.ts";
import { type MailProvider, IntegrationError } from "./types.ts";
import { mailManifest } from "./manifest.ts";
const email = "property@example.com";
const draft = (accountId: string, extra = {}) => ({ accountId, requestId: "draft-1", to: ["tenant@example.com"], subject: "Repair", body: "The contractor can visit Tuesday.", ...extra });
function setup() {
  const state = new MemoryJsonState(); let saves = 0; let refreshes = 0;
  const provider: MailProvider = { id: "test-provider", name: "Another mail provider", auth: "token", configured: true,
    identity: async token => ({ email: token === "other" ? "other@example.com" : email, remoteId: token === "other" ? "other" : "property" }),
    search: async () => ({ messages: [] }), read: async () => { throw new IntegrationError("Not found", 404); }, attachment: async () => ({ name: "invoice.txt", type: "text/plain", data: "YWJj" }),
    saveDraft: async (_ctx, input) => { saves++; return { id: input.draftId ?? "draft1", messageId: "message1" }; },
    refresh: async c => { refreshes++; return { ...c, accessToken: "fresh", expiresAt: Date.now() + 3600_000 }; },
  };
  const service = new MailService(state, [provider]);
  const connect = (token = "secret-value") => service.connectToken(provider.id, { name: "Oak Street", purpose: "Maintenance", token });
  return { service, state, provider, connect, saves: () => saves, refreshes: () => refreshes };
}
test("generic provider lifecycle never projects credentials; separate accounts retain purpose", async () => {
  const s = setup(); const first = await s.connect(); const second = await s.connect("other");
  expect(first.id).not.toBe(second.id);
  expect(s.service.catalog()).toEqual([{ id: "test-provider", name: "Another mail provider", auth: "token", configured: true }]);
  expect(JSON.stringify(await s.service.action("mail_accounts", {}))).not.toContain("secret-value");
  expect(s.service.list()[0]).toMatchObject({ purpose: "Maintenance", email });
  expect((await s.connect()).id).toBe(first.id);
  expect(s.service.list()).toHaveLength(2);
  await expect(s.service.connectToken("test-provider", { name: "Wrong", token: "other", reconnectId: first.id })).rejects.toThrow("same account");
  await s.service.remove(first.id); expect(s.service.list()).toHaveLength(1);
  await expect(s.service.action("mail_search", { accountId: first.id, query: "" })).rejects.toThrow("disconnected");
});
test("no send, generic HTTP, provider escape or caller-controlled sender", async () => {
  const s = setup(); const account = await s.connect();
  for (const name of ["mail_send", "messages.send", "drafts.send", "http"]) await expect(s.service.action(name, { accountId: account.id })).rejects.toThrow("not allowed");
  for (const extra of [{send: true}, {from: "other@example.com"}, {url: "https://evil.example"}, {method: "POST"}]) await expect(s.service.action("mail_save_draft", draft(account.id, extra))).rejects.toThrow();
  expect(s.saves()).toBe(0);
  expect(mailManifest.map(m => m.name)).not.toContain("mail_send");
});
test("draft retries are idempotent, changed input requires a new request ID, and updates are account-scoped", async () => {
  const s = setup(); const account = await s.connect(); const other = await s.connect("other");
  const input = draft(account.id);
  const results = await Promise.all([s.service.action("mail_save_draft", input), s.service.action("mail_save_draft", input)]);
  expect(results[0]).toEqual(results[1]); expect(s.saves()).toBe(1);
  await expect(s.service.action("mail_save_draft", draft(account.id, {body: "changed"}))).rejects.toThrow("new requestId");
  await expect(s.service.action("mail_save_draft", draft(other.id, {requestId: "update", draftId: "draft1"}))).rejects.toThrow("Only drafts");
  await expect(s.service.action("mail_save_draft", draft(account.id, {requestId: "update", draftId: "owner-draft"}))).rejects.toThrow("Only drafts");
  await s.service.action("mail_save_draft", draft(account.id, {requestId: "update", draftId: "draft1"}));
  expect(s.saves()).toBe(2);
});
test("uncertain draft outcomes are not silently retried", async () => {
  const s = setup(); const account = await s.connect(); let writes = 0;
  s.provider.saveDraft = async () => { writes++; throw new Error("secret provider transport details"); };
  await expect(s.service.action("mail_save_draft", draft(account.id))).rejects.toThrow("mail operation failed");
  await expect(s.service.action("mail_save_draft", draft(account.id))).rejects.toThrow("not confirmed");
  expect(writes).toBe(1);
});
test("expired credentials refresh once across concurrent calls and errors redact provider details", async () => {
  const s = setup(); const account = await s.connect();
  const key = `integrations:mail:account:${account.id}`; const stored = s.state.get<any>(key); stored.credential.expiresAt = 1; s.state.set(key, stored);
  await Promise.all([s.service.action("mail_search", {accountId: account.id, query: ""}), s.service.action("mail_search", {accountId: account.id, query: ""})]);
  expect(s.refreshes()).toBe(1);
  s.provider.search = async () => { throw new IntegrationError("Reconnect this account.", 401); };
  await expect(s.service.action("mail_search", {accountId: account.id, query: ""})).rejects.toThrow("Reconnect");
  expect(s.service.list()[0]?.status).toBe("needs-attention");
});
test("OAuth state is single-use and provider-bound", async () => {
  const s = setup();
  s.provider.authorizationUrl = state => `https://provider.example/?state=${state}`;
  s.provider.exchange = async () => ({accessToken: "secret-value", refreshToken: "refresh"});
  const start = s.service.begin("test-provider", { name: "Property" });
  await expect(s.service.finish("wrong", start.state, "code")).rejects.toThrow("expired");
  await expect(s.service.finish("test-provider", start.state, "code")).rejects.toThrow("expired");
  const next = s.service.begin("test-provider", {name: "Property"});
  expect(await s.service.finish("test-provider", next.state, "code")).toMatchObject({email});
  await expect(s.service.finish("test-provider", next.state, "code")).rejects.toThrow("expired");
});
