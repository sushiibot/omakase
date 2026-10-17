import { expect, test } from "bun:test";
import { MemoryJsonState } from "../../db/jsonState.ts";
import { MailService } from "../../integrations/mail/service.ts";
import type { MailProvider } from "../../integrations/mail/types.ts";
import { MailRoutes } from "./mailRoutes.ts";
import { createWebHandler } from "./server.ts";
const provider: MailProvider = {id: "gmail", name: "Google", auth: "oauth", configured: true, identity: async () => ({email: "owner@example.com", remoteId: "owner"}), search: async () => ({messages: []}), read: async () => { throw new Error(); }, attachment: async () => { throw new Error(); }, saveDraft: async () => ({id: "draft", messageId: "message"}), authorizationUrl: state => `https://accounts.google.com/?state=${state}`, exchange: async () => ({accessToken: "private-token", refreshToken: "private-refresh"})};
function setup() {
  const state = new MemoryJsonState(); const service = new MailService(state, [provider]); const mail = new MailRoutes(service, state);
  const handler = createWebHandler({config: {devLogin: undefined, push: undefined, port: 0, bindAddr: "127.0.0.1", ownerLogin: "owner@example.com", distDir: "/tmp/no-build", trustedPeers: ["127.0.0.1"]}, peers: ip => ip === "127.0.0.1", mail});
  const request = (path: string, body?: unknown, headers = {}) => handler(new Request(`https://app.example${path}`, {method: body === undefined ? "GET" : "POST", headers: {"Tailscale-User-Login": "owner@example.com", "Sec-Fetch-Site": "same-origin", ...(body === undefined ? {} : {"Content-Type": "application/json"}), ...headers}, ...(body === undefined ? {} : {body: JSON.stringify(body)})}), "127.0.0.1");
  return {service, request};
}
test("owner-only setup and rules reject cross-site writes", async () => {
  const s = setup();
  expect((await s.request('/api/mail', undefined, {"Tailscale-User-Login": "stranger@example.com"})).status).toBe(403);
  expect((await s.request('/api/tool-policy', {rules: "Read only"}, {"Sec-Fetch-Site": "cross-site"})).status).toBe(403);
  expect((await s.request('/api/tool-policy', {rules: "Read only"})).status).toBe(200);
  expect(await (await s.request('/api/tool-policy')).json()).toEqual({rules: "Read only"});
});
test("OAuth callback accepts an owner navigation only with matching one-use state cookie", async () => {
  const s = setup(); const begin = await s.request('/api/mail/providers/gmail/begin', {name: "Property"});
  const cookie = begin.headers.get('set-cookie')!; expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure');
  const {url} = await begin.json() as {url: string}; const state = new URL(url).searchParams.get('state');
  const callback = `/api/mail/oauth/gmail/callback?state=${state}&code=private-code`;
  const missing = await s.request(callback, undefined, {"Sec-Fetch-Site": "cross-site"}); expect(missing.headers.get('location')).toContain('failed'); expect(s.service.list()).toHaveLength(0);
  const response = await s.request(callback, undefined, {"Sec-Fetch-Site": "cross-site", cookie: cookie.split(';')[0]!});
  expect(response.status).toBe(303); expect(response.headers.get('location')).toBe('/connectors/mail?connection=connected');
  expect(JSON.stringify(await (await s.request('/api/mail')).json())).not.toContain('private-');
  expect((await s.request(callback, undefined, {cookie: cookie.split(';')[0]!})).headers.get('location')).toContain('failed');
});
