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
