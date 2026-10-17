# Integration API keys

Open **Connectors → API keys** to configure a supported service.
Google Maps Places API (New) is the first supported service.
Other services need a server adapter before they can use this storage.

## Guided setup

The agent's `integrations` tool lists supported services and their current credential status.
When a key is missing, the tool returns setup instructions and `/connectors/keys`.
The agent can link to this form from any conversation.
After saving a key, return to the conversation and ask the agent to continue.
The agent checks the current status without a restart.

1. Follow the Google setup links in the form.
2. Enable billing and Places API (New) in your Google Cloud project.
3. Restrict the key to Places API (New) and the gateway's public outgoing IP address.
4. Enter the key in the password field.
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

The gateway creates `integration-secrets.key` beside `DATABASE_PATH` with file permissions `0600`.
Back up this file with the database. Restore the original file if it is lost.
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

The server sends Google Maps keys only to the fixed Places API endpoint.
Redirects are disabled. Agent input cannot select a destination or authentication header.
Search results include Google Maps links and attribution data.

The chat renderer permits only the exact `/connectors/keys` setup link.
Setup links with query strings or fragments remain blocked. Existing artifact links remain available.

## References

- [Google Maps key setup](https://developers.google.com/maps/documentation/places/web-service/get-api-key)
- [Google Maps security guidance](https://developers.google.com/maps/api-security-best-practices)
- [Places Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search)
