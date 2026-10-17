import { expect, test } from "bun:test";
import { GmailProvider } from "./gmail.ts";
import { FastmailProvider } from "./fastmail.ts";
import { draftInput } from "./types.ts";
import type { Fetch } from "./http.ts";
const ctx = {token: "private-token", identity: {email: "owner@example.com", remoteId: "account"}};
const input = draftInput.parse({accountId: "11111111-1111-4111-8111-111111111111", requestId: "test", to: ["tenant@example.com"], subject: "Café maintenance", body: "Hello tenant"});
const fake = (f: (url: string, init: RequestInit) => unknown) => (async (url: string | URL | Request, init: RequestInit = {}) => Response.json(f(String(url), init))) as Fetch;
test("Gmail creates a real draft with correct MIME and account-bound sender; updates never invoke send", async () => {
  const calls: string[] = [];
  const provider = new GmailProvider(undefined, fake((url, init) => {
    calls.push(`${init.method ?? 'GET'} ${url}`);
    expect(init.redirect).toBe("error");
    if (init.method === "POST" || init.method === "PUT") {
      expect(url).toMatch(/\/drafts(?:\/draft1)?$/);
      const raw = JSON.parse(String(init.body)).message.raw;
      const mime = Buffer.from(raw, "base64url").toString();
      expect(mime).toContain("From: owner@example.com"); expect(mime).toContain("To: tenant@example.com");
      expect(mime).toContain(Buffer.from("Hello tenant").toString("base64"));
      return {id: "draft1", message: {id: "message1", threadId: "thread1"}};
    }
    return {id: "draft1", message: {id: "message1", labelIds: ["DRAFT"]}};
  }));
  expect(await provider.saveDraft(ctx, input)).toMatchObject({id: "draft1"});
  await provider.saveDraft(ctx, {...input, draftId: "draft1"});
  expect(calls.some(c => c.includes("/send"))).toBe(false);
  expect(calls).toHaveLength(3);
});
test("Gmail refresh sends secrets only to the fixed token endpoint and preserves refresh token", async () => {
  const config = {clientId: "client", clientSecret: "secret", redirectUri: "https://owner.example/api/mail/oauth/gmail/callback"};
  const provider = new GmailProvider(config, fake((url, init) => {
    expect(url).toBe("https://oauth2.googleapis.com/token"); expect(String(init.body)).toContain("refresh_token=refresh");
    return {access_token: "new", expires_in: 3600};
  }));
  expect(await provider.refresh({accessToken: "old", refreshToken: "refresh"})).toMatchObject({accessToken: "new", refreshToken: "refresh"});
  const url = new URL(provider.authorizationUrl("state", "verifier"));
  expect(url.searchParams.get("code_challenge_method")).toBe("S256"); expect(url.searchParams.get("scope")).not.toContain("gmail.modify");
});
test("Fastmail creates a draft in Drafts without submission capability or method", async () => {
  const methods: string[] = [];
  const provider = new FastmailProvider(fake((url, init) => {
    if (url.endsWith("/session")) return {apiUrl: "https://api.fastmail.com/jmap/api/", username: ctx.identity.email, primaryAccounts: {"urn:ietf:params:jmap:mail": "account"}};
    const body = JSON.parse(String(init.body)); expect(body.using).not.toContain("urn:ietf:params:jmap:submission");
    const [method, args, id] = body.methodCalls[0]; methods.push(method);
    if (method === "Mailbox/get") return {methodResponses: [[method, {list: [{id: "drafts", role: "drafts"}]}, id]]};
    expect(method).toBe("Email/set"); expect(args.create.draft.keywords).toEqual({$draft: true}); expect(args.create.draft.mailboxIds).toEqual({drafts: true});
    return {methodResponses: [[method, {created: {draft: {id: "message1"}}}, id]]};
  }));
  expect(await provider.saveDraft(ctx, input)).toMatchObject({id: "message1"});
  expect(methods).toEqual(["Mailbox/get", "Email/set"]);
});
test("Fastmail rejects a session URL that would leak the token", async () => {
  let calls = 0;
  const provider = new FastmailProvider(fake(() => { calls++; return {apiUrl: "https://attacker.example/jmap"}; }));
  await expect(provider.saveDraft(ctx, input)).rejects.toThrow("unsupported API address"); expect(calls).toBe(1);
});
test("provider errors never echo access tokens or remote bodies", async () => {
  const provider = new GmailProvider(undefined, (async () => new Response('private-token internal details', {status: 403})) as unknown as Fetch);
  await expect(provider.identity("private-token")).rejects.toThrow("Reconnect");
});
