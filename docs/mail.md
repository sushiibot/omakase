# Mail accounts and tool-use rules

Open **Settings → Mail accounts** to add an account.
Select **Add account**. Give each account a name and purpose, such as a property address.
The agent selects accounts explicitly. It can read mail and save drafts in the provider's mailbox.
Review and send drafts in Gmail or Fastmail yourself.

## Google setup

Configure one OAuth application for the gateway. Each Google account then signs in separately.
Google handles passwords and two-factor authentication.

1. Create a Google Cloud project and enable the Gmail API.
2. Configure the OAuth consent screen for your personal application.
3. Create an OAuth client of type **Web application**.
4. Register this redirect URI: `https://<your-app-host>/api/mail/oauth/gmail/callback`.
5. Set these variables on the gateway, not the workspace:

```sh
MAIL_GOOGLE_CLIENT_ID=<client-id>
MAIL_GOOGLE_CLIENT_SECRET=<client-secret>
MAIL_GOOGLE_REDIRECT_URI=https://<your-app-host>/api/mail/oauth/gmail/callback
```

6. Restart the gateway. Open **Mail accounts**, name the account, and select **Continue with Google**.
7. Select the Google account and approve both mail permissions.

The callback must reach the owner-authenticated web gateway through the same browser.
For local development, an HTTP callback on `localhost` or `127.0.0.1` is supported.
The callback state expires after ten minutes and can be used once.

Google applications in external **Testing** status receive mail refresh tokens that expire after seven days.
Choose the appropriate publishing status for continued personal use. Follow Google's consent and verification requirements for your application.

The application requests `gmail.readonly` and `gmail.compose`.
Google bundles draft management and sending in `gmail.compose`.
The gateway exposes only mail reads and draft saves. It has no send operation or arbitrary authenticated request endpoint.

## Fastmail setup

1. Open Fastmail **Settings → Privacy & Security → Manage API tokens**.
2. Create a JMAP token with mail read/write access. Leave sending access off when selecting permissions.
3. Select **Fastmail** in **Mail accounts**.
4. Enter an account name, an optional purpose, and the token.
5. Select **Connect account**.

The gateway uses JMAP mail methods. It never requests the submission capability or calls `EmailSubmission/set`.
The token stays in the gateway. The web form clears its token field after submission.
Existing Fastmail MCP connections remain separate. Disconnect them when replacing their access with native mail.

## Tool review

The existing decision model reviews MCP calls and native draft saves.
MCP reviews include the current tool description, schema, and arguments.
Server descriptions and annotations are evidence, not authorization.

Actions that notify external people require human approval for that call.
Examples include sending mail, sharing documents, posting messages, and sending calendar invitations.
If the reviewer cannot decide, the app asks the owner. Without an interactive approval surface, the call is blocked.
Integration review remains enabled when general workspace auto mode is off.
Scheduled MCP calls also receive per-call review. Calls that need approval are blocked in background jobs.

Set additional restrictions in **Settings → Tool permissions**.
The read-only and draft-only presets fill the rules field. Select **Save rules** to apply them.
The gateway stores these rules. Agent tools can read them but cannot change them.

Model review is a sanity check, not a provider permission boundary.
For strict read-only MCP access, also restrict the provider token.
A compromised workspace can bypass its local MCP reviewer. Native mail still has no gateway send operation.

## Storage and deployment

Connection records and tokens use the gateway's existing private SQLite key-value storage.
No new database migration or service is required.
Never mount the gateway database, its backups, or Google client credentials into the workspace.
Keep gateway deployment credentials outside agent-controlled environments.
The native-mail boundary assumes the agent cannot change or redeploy gateway code.

Disconnect removes the local account credential.
For Google, the gateway also attempts to revoke the grant.
If revocation fails, the app tells you to revoke access in the provider's settings.
Fastmail API tokens must be revoked in Fastmail.
Removing an account does not remove drafts from its mailbox.

## Limits

- Search reads one account at a time. Gmail supports Gmail search syntax. Fastmail supports full-text search.
- Each search returns up to 25 messages. Use the returned cursor for another page.
- Attachment reads support files up to 1 MB. Draft attachments support four files, about 256 KB each.
- The agent can update only drafts created by this integration.
- Each draft save needs a unique `requestId`. An identical retry returns the recorded result.
- If a save fails after submission, inspect Drafts before trying a new request ID.
- Fastmail replaces draft content by creating a new draft. The old draft can remain if cleanup fails.
- Calendars, contacts, mailbox organization, and background synchronization are not included.
- Native draft saves are available only through interactive sessions. Scheduled jobs can use mail reads.

## Add another provider

Implement `MailProvider` in `src/integrations/mail/types.ts` and register it in `createMailService`.
The shared service handles account identity, naming, credential refresh, safe public records, and draft ownership.
The existing tool bridge and review policy do not need provider-specific branches.
Authentication hooks support token setup or OAuth authorization, exchange, refresh, and revocation.
Add provider-specific setup help to the account form when the authentication requirements differ.

Provider adapters construct fixed API requests. Never accept caller-supplied URLs, HTTP methods, or authorization headers.
Test account separation, credential redaction, draft creation, retries, and rejection of unsupported operations.

## References

- [Google OAuth web applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google refresh-token limits](https://developers.google.com/identity/protocols/oauth2#expiration)
- [Gmail authorization scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Gmail drafts](https://developers.google.com/workspace/gmail/api/guides/drafts)
- [Fastmail APIs](https://www.fastmail.com/dev/)
- [JMAP mail specification](https://www.rfc-editor.org/rfc/rfc8621.html)
