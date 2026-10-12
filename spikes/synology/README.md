# Synology file-store spike

This spike compares WebDAV and File Station over direct HTTP(S) connections. It does not add a production file-store backend, local index, mount, sync queue, or machine-daemon dependency.

## Comparison

| Operation | WebDAV | File Station API |
|---|---|---|
| Folder listing | `PROPFIND`, including ETags and file metadata | Paged JSON listing with size, timestamps, and permissions |
| Filename search | Requires client traversal in this spike | NAS performs recursive filename/metadata search; client polls and cleans up its task |
| Read a document | HTTP `GET` | Download API; authentication is a session cookie |
| Short read-cache validation | `If-None-Match`, potentially `304` | No equivalent version validator established by the API guide |
| Create a file | `PUT` with `If-None-Match: *` | Upload with overwrite omitted; existing destination must cause an error |
| Replace a file | `PUT` with a strong ETag in `If-Match` | Upload with overwrite enabled; no expected-version precondition established |
| Authentication | Dedicated NAS account; credentials in backend | Dedicated NAS account; log in, retain session privately, log out |

WebDAV is the candidate for conditional writes. File Station is the candidate for server-side filename search across a high-latency connection. File Station search is not a documented PDF content-search service. Neither protocol removes network latency.

The choice remains provisional until the actual NAS passes the write-conflict tests. In particular, an upload overwrite option is not conflict protection. A File Station implementation must not describe a read-then-overwrite check as atomic.

## Run local protocol tests

Python 3 and OpenSSL are required. The tests use temporary local HTTP/TLS servers and generated certificates.

```sh
python3 -m unittest discover -s spikes/synology -v
```

The tests cover correct WebDAV preconditions, temporary and persistent weak ETags, a server that incorrectly ignores preconditions, File Station discovery/auth/search/upload/download, search-task cleanup after failure, logout, read-only execution, and rejection of a bad certificate pin before any HTTP request or credential is sent.

## Run against the NAS

Create a private JSON config outside the repository. Use a dedicated account or an explicitly authorized existing credential. The client never reads passwords from mount configuration or SSH settings.

```json
{
  "username": "agent-spike",
  "password_env": "NAS_SPIKE_PASSWORD",
  "measurement_location": "Hetzner Germany",
  "search_pattern": "*.md",
  "endpoints": {
    "webdav": {
      "url": "https://nas-tailnet-name:5006",
      "root": "/public/Property"
    },
    "filestation": {
      "url": "https://nas-tailnet-name:5001",
      "root": "/public/Property"
    }
  }
}
```

The password can instead be a `password` field in the private config. Protect it with `chmod 600`. Do not put passwords in shell arguments or commit the config. Each endpoint can be tested independently by omitting the other one.

Normal certificate and hostname verification is enabled. For a private CA, set `ca_file` to its PEM file. For a NAS certificate verified through DSM or trusted SSH, an endpoint can use `certificate_sha256` with its exact SHA-256 fingerprint. The client checks the pin before transmitting credentials. A fingerprint merely observed over an untrusted connection is not sufficient verification.

Run read-only listing and search first:

```sh
python3 spikes/synology/spike.py --config /private/path/nas-spike.json --output /tmp/nas-spike-read.json
```

Then run temporary-file write tests:

```sh
python3 spikes/synology/spike.py --config /private/path/nas-spike.json --writes --output /tmp/nas-spike-write.json
```

`--writes` creates uniquely named `.sushii-protocol-spike-<random>.txt` files only in the configured root. It reads back, replaces, and cleans up those files. It does not modify existing property documents. If cleanup cannot be completed, retain the report and remove the named scratch file after checking it.

The spike limits each response to 4 MiB and uses small generated text files for write tests. It does not benchmark large PDFs or perform OCR.

Reports contain request timings, response sizes, HTTP status codes, API error codes, and test outcomes. They exclude passwords, session IDs, and original document contents. Timing includes initial connection setup for the first request; later requests reuse the connection. Run the same config from Hetzner to measure the actual Germany-to-California path. LAN timings cannot establish WAN performance.

The WebDAV test writes two different versions with the same length, then attempts a stale conditional write. It checks both the rejection status and retained newer content. A server that ignores `If-Match` is reported as a failed write test. A bounded two-second wait allows a recent weak ETag to settle; a missing or persistently weak ETag still blocks replacement and conditional cleanup. Before production use, also test external changes made through SMB; File Station changes were checked separately in the live experiment below.

## Live NAS results

Unauthenticated checks on the owner's LAN found:

- DSM responds and advertises the required File Station list/search/upload/download/delete APIs.
- DSM HTTPS uses a private certificate. Its fingerprint was verified by running `openssl s_client` against the NAS loopback endpoint through trusted SSH. The spike then pinned that certificate before sending credentials.
- SSH succeeds with the existing key as `drklee3@192.168.1.100`; the hostname is `fileserver`. Passwordless sudo is unavailable.
- Tailscale was updated to `1.104.1`; it reports Running, online, and no health warnings. Direct tailnet ping succeeds. The owner reports creating daily maintenance and boot networking tasks; their settings cannot be independently read through the current SSH account.
- The owner installed WebDAV Server and enabled HTTPS on port 5006. Its certificate was verified through trusted SSH before authentication.

The owner explicitly authorized reuse of the existing mount credentials. File Station login and listing succeeded: Property contained 26 immediate entries. One recursive filename search completed with 125 results, of which the spike requested the first 100. A later search returned `finished` without files or a total; search-result consistency needs further investigation before production use.

The live write test created a unique scratch file, verified its bytes, replaced it, verified the replacement, deleted it, and logged out successfully. Existing property documents were not changed. The first upload attempt returned API error 119: DSM did not accept a session ID inside the multipart body. Using a session cookie resolved it; uploads and downloads now keep session IDs out of URLs.

Live WebDAV tests passed listing, create/read, unchanged-read validation (`304`), same-sized replacement, stale-write rejection (`412`) with newer content retained, and conditional deletion (`204`). Immediately after creation or replacement, this NAS briefly returns weak ETags; they become strong after a short delay. The first test stopped safely on a weak ETag, and its owned scratch file was verified and removed through File Station.

A separate cross-protocol experiment created another unique scratch file and made two same-sized replacements through File Station. WebDAV returned the newer bytes rather than a stale `304`, rejected writes using the old strong ETag with `412`, and preserved the newer bytes after each attempt. The scratch file was deleted. Changes through SMB remain untested.

These tests ran on the California LAN, not from Hetzner. They support WebDAV as the document-access candidate, with File Station optionally handling filename search. They do not establish WAN performance, universal concurrency guarantees, or behavior with every editing client. No production external file-store backend has been added.

## References

- [Synology File Station API guide](https://global.download.synology.com/download/Document/Software/DeveloperGuide/Package/FileStation/All/enu/Synology_File_Station_API_Guide.pdf)
- [Synology WebDAV specifications](https://www.synology.com/en-us/dsm/7.4/software_spec/webdav)
- [WebDAV standard: ETags](https://www.rfc-editor.org/rfc/rfc4918.html#section-8.6)
- [Tailscale on Synology](https://tailscale.com/docs/integrations/synology)
