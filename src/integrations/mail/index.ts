import type { JsonState } from "../../db/jsonState.ts";
import { GmailProvider } from "./gmail.ts";
import { FastmailProvider } from "./fastmail.ts";
import { MailService } from "./service.ts";
export function createMailService(state: JsonState, env: NodeJS.ProcessEnv = process.env) {
  const { MAIL_GOOGLE_CLIENT_ID: clientId, MAIL_GOOGLE_CLIENT_SECRET: clientSecret, MAIL_GOOGLE_REDIRECT_URI: redirectUri } = env;
  let config;
  if (clientId && clientSecret && redirectUri) {
    const url = new URL(redirectUri);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("MAIL_GOOGLE_REDIRECT_URI must use HTTPS or local development HTTP");
    if (url.pathname !== "/api/mail/oauth/gmail/callback" || url.search || url.hash || url.username || url.password) throw new Error("MAIL_GOOGLE_REDIRECT_URI must end in /api/mail/oauth/gmail/callback without query or credentials");
    config = { clientId, clientSecret, redirectUri };
  }
  return new MailService(state, [new GmailProvider(config), new FastmailProvider()]);
}
