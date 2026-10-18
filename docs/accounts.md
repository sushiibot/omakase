# Website account credentials

The gateway stores generated website passwords. The agent receives account metadata and version numbers. It never receives passwords through the `accounts` tool.

## Lifecycle

Use `prepare` to create a pending account and password candidate. Use a unique `requestId` for each operation. Reuse that ID only for an identical retry.

Use browser account fill to enter the candidate into the intended website. Fill does not submit the form. Confirm the version only after the website accepts it.

Use `revise` when a website rejects the candidate. Supply its password requirements and the expected version. Previous versions remain encrypted and available to the owner.

`confirmedVersion` identifies the last accepted password. `version` identifies the latest candidate. A revision returns the account to pending status without discarding its confirmed version.

Archive an unused account to prevent further browser fills and revisions. Archived passwords remain available to owner reveal and copy operations. They also remain in the redaction inventory.

The owner can view accounts, reveal or copy passwords, inspect audit history, and archive accounts at `/accounts`.

## Encryption key and recovery

By default, the gateway creates `accounts-secrets.key` beside its database. The file contains a random 32-byte encryption key with mode `0600`.

Set `ACCOUNTS_MASTER_KEY_FILE` to use an existing 32-byte binary key file. Provisioned key files can be read-only. The gateway does not create or modify them.

The account key is separate from the integration key. Account passwords use AES-256-GCM with a fresh nonce for each version. Authentication data binds each ciphertext to its account ID and version.

The database contains ciphertext, metadata, request records, and audit events. Request records contain no passwords. The service uses existing `kv` storage without new database migrations.

Back up the database and its original account key. Protect the key separately from database backups when possible. Never mount either file into the workspace container.

If the key is missing, restore the original key before startup. Do not replace it with a new key. A missing or incorrect key prevents access to existing passwords. Startup checks every retained password version.

## Access boundaries

Owner account endpoints use the gateway's authenticated, same-origin routing. Responses use `Cache-Control: no-store`. Reveal and copy require explicit POST requests and produce audit events.

The private `accounts/internal` RPC checks the authenticated workspace connection and owner principal. Fill requires an exact website origin, including scheme and port. It rejects archived accounts and unsupported versions. HTTP origins are permitted only for localhost and loopback development servers.

A fill receipt belongs to the requesting connection and expires after ten minutes. Fill completion records success or failure without storing the password in its audit event.

The private redaction RPC scans all retained password versions, including archived accounts. It replaces exact values and common encoded forms in nested JSON values and keys. It preserves the remaining JSON structure. Each detected account version produces an audit event without the matching text.

Corrupt records, decryption failures, and unsupported payloads cause redaction to fail. Callers must stop the model request when redaction fails. Redaction does not cover arbitrary transformations, screenshots, or secrets outside this store.

## Browser use

The `accounts` tool creates credentials. The `browser` tool fills them without password values in its arguments.

1. Open the website in the managed browser.
2. Call `accounts` with `action: "prepare"`, the HTTPS origin, username, name, and a unique request ID.
3. Inspect the password fields to obtain unique CSS selectors.
4. Call the browser tool with the returned account ID:

```json
{
  "args": ["fill-account"],
  "accountId": "<account UUID>",
  "fields": {
    "username": "#email",
    "password": "#password",
    "confirmPassword": "#confirm-password"
  }
}
```

5. Submit the form with the normal browser tools.
6. If the website accepts the password, call `accounts` with `action: "confirm"` and the expected version.
7. If the website rejects its requirements, call `revise` with an updated password policy and a new request ID.

The fill operation supports Chromium and Camoufox. It requires HTTPS and top-level input fields. Password fields must use `type="password"`.
CSS selectors must identify one input each. Snapshot references such as `@e3`, iframe fields, and shadow-root fields are not supported by this operation.
The fill operation does not submit forms. A timeout does not prove that a website rejected a submission.

Policies support minimum and maximum lengths, required character classes, and an allowed symbol set. Supported lengths are 12 through 128 characters.
A false `requireSymbols` value removes the requirement. An empty `allowedSymbols` value also excludes symbols from generation.

## Redaction limits

The workspace sends final model request payloads to the gateway scanner. A scanner failure prevents that model request.
The scanner covers main conversations, subagents, scheduled work, the judge, and compaction calls that use the shared runtime.

The scanner does not rewrite existing browser buffers or stored transcripts. Ordinary browser read or evaluation tools can expose passwords in those records.
Encrypted credential storage does not encrypt those separate artifacts. Screenshots and arbitrary transformations remain outside the text matcher.

A redaction event records a match before an attempted model send. It does not prove that the provider received or accepted the request.
A fill event records field entry, not successful website authentication. The owner can inspect these events in each account history.
