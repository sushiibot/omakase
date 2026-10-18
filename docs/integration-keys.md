# Integration API keys

Open **Connectors → API integrations** to connect a service.
**MCP servers** is a separate page under **Connectors**.
Google Maps Places API (New) is the first supported service.
Other JSON HTTP APIs can use the generic broker with header or Bearer authentication.
OAuth, signed requests, streaming, uploads, and non-HTTP protocols need dedicated adapters.

## Guided setup

The agent's `integrations` tool lists supported services and their current credential status.
When a key is missing, the tool returns setup instructions and `/connectors/keys`.
The agent can link to this form from any conversation.
Select **Connect a service** or **Guide setup** to start guidance in chat.
The agent checks live status, finds official links, and explains one step at a time.
The handoff preserves any existing chat draft and attachments.
After saving a key, select **Continue with agent** to resume.
The agent checks the current status without a restart.

1. Select **Guide setup** for Google Maps.
2. Enable billing and Places API (New) in your Google Cloud project.
3. Restrict the key to Places API (New) and the gateway's public outgoing IP address.
4. Open the secure form, select **I already have a key**, and enter the key.
5. Select **Save and test**.

Validation makes one Places request and can incur a Google charge.
A failed test preserves the previous credential.
The field clears after submission, including a failed test.
Use **Remove key** to delete the stored credential.
Removal does not revoke the key in Google Cloud or cancel an API request already sent.

## Storage and access

The gateway encrypts credentials with AES-256-GCM in the existing database key-value table.
Each record uses a random nonce and binds its integration ID as authenticated data.
No database migration is required.

By default, the gateway creates `integration-secrets.key` beside `DATABASE_PATH` with file permissions `0600`.
For separate key storage, set `INTEGRATION_MASTER_KEY_FILE` to a provisioned, read-only file containing exactly 32 bytes.
The gateway does not create or change that provisioned file.
When migrating existing credentials, copy the original key bytes into the separately managed secret. Do not generate a replacement key.
Keep the encryption key and database backups separately protected. Restore the original key if it is lost.
The gateway refuses startup when saved credentials exist but the key file is missing.
A host administrator with both files can decrypt the credentials.
Do not mount either file into the workspace container.

The owner form sends the key directly to the authenticated gateway.
There is no credential-read endpoint or tool.
Neither chat history nor browser storage receives the key.
The gateway does not inject these credentials into agent environment variables.
Saved keys take precedence over the existing gateway `GOOGLE_MAPS_API_KEY` setting.
Removing a saved key restores that environment fallback, if configured.
The existing Maps CLI uses the saved key for searches, place details, and routes.
Enable Routes API and add it to the key restrictions before requesting routes.
Save and test validates Places access only. Route access is checked when a route is requested.
API responses contain status, setup guidance, or search results.
Provider errors use fixed messages to avoid exposing credentials.

Google Maps uses dedicated Places and Routes endpoints.
Redirects are disabled. Agent input cannot select a destination or authentication header.
Search results include Google Maps links and attribution data.

The chat renderer permits only the exact `/connectors/keys` setup link.
Setup links with query strings or fragments remain blocked. Existing artifact links remain available.

## Generic APIs

The agent researches the provider documentation and proposes an integration through `integrations propose` or the `integrations` tool.
A proposal contains no credential. It defines the HTTPS origin, authentication header, and exact method/path pairs.
Each operation declares its query parameter names and whether it accepts a JSON body.
The setup form shows these details and the documentation link. Agent-supplied links are labelled as such.

Review the destination and operations before you select **Approve access and save**.
This grants ongoing access to those operations, including writes. JSON bodies can select additional actions or resources.
A generic save does not call the provider. The first requested operation checks credential access.
Use restricted provider credentials. An endpoint grant does not restrict every possible body value.
For example, a GraphQL endpoint can expose both reads and writes through one POST operation.

The agent cannot update an existing definition. Remove it in the form before proposing a changed definition.
Approval binds to the current definition revision. A stale form cannot approve a replacement definition.
Removal deletes the saved credential and definition. It does not revoke the provider key or cancel an in-flight request.
Return to the conversation after setup so the agent can check live status and continue.

## Requests and CLI compatibility

The workspace helper supports these commands:

```sh
integrations list
integrations propose '<definition JSON>'
integrations request '{"integration":"example","operation":"search","query":{"q":"coffee"}}'
integrations exec example -- sh -c 'curl -sS "$INTEGRATION_BASE_URL/v1/search?q=coffee" -H "Authorization: Bearer $INTEGRATION_TOKEN"'
```

The final two examples require an approved integration named `example` with a matching search operation.
The shipped integrations skill documents the definition format and setup workflow.
The helper uses a private Unix socket and the existing authenticated workspace RPC connection.
The gateway checks approval and operation scope on every request.

`exec` starts a temporary loopback endpoint and runs the specified command in the workspace.
Its environment contains the local endpoint and a random proxy token. Neither value is a provider credential.
Configure the CLI's API endpoint and Bearer or configured header authentication using its documented options.
The proxy closes when the command exits or after ten minutes.
It rejects browser origins, incorrect hosts, missing tokens, and unapproved operations.
The gateway rechecks each call, so removing an integration stops subsequent requests from an existing proxy.

Compatibility is limited to exact paths, JSON responses, and approved JSON bodies and query parameters.
Arbitrary CLI headers, binary responses, uploads, streaming, redirects, and HTTP CONNECT are unsupported.
Test each existing CLI before describing it as supported. The curl path has an automated integration test.
There is no general server-side command runner. Tools that require provider credentials inside their process need a dedicated isolated adapter.

## Broker boundaries

The gateway resolves the approved hostname and rejects non-public destination addresses.
It connects to a validated numeric address while preserving the original TLS server name and certificate verification.
It does not follow redirects, use ambient HTTP proxies, or retry requests automatically.

Limits are 32 KiB per request, 1 MiB per response, four concurrent requests, 30 requests per minute, and 1,000 per day per integration.
Usage survives gateway restarts. Deleting an integration does not reset its usage window.
The gateway stores only the last operation name, time, and response status as activity metadata.
It does not store request bodies, query values, response bodies, or authentication headers in that activity record.
Successful API results can still contain sensitive account data. The workspace and model receive those results.
Known credential strings are redacted from responses. Only approve trusted provider destinations; redaction cannot make a malicious provider safe.

## References

- [Google Maps key setup](https://developers.google.com/maps/documentation/places/web-service/get-api-key)
- [Google Maps security guidance](https://developers.google.com/maps/api-security-best-practices)
- [Places Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search)

- [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP secrets management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [OWASP agent security](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)
