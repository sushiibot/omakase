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

The tests cover correct WebDAV preconditions, a server that incorrectly ignores them, File Station discovery/auth/search/upload/download, search-task cleanup after failure, logout, read-only execution, and rejection of a bad certificate pin before any HTTP request or credential is sent.

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

The WebDAV test writes two different versions with the same length, then attempts a stale conditional write. It checks both the rejection status and retained newer content. A server that ignores `If-Match` is reported as a failed write test. Before production use, also test external changes made through SMB/File Station; the spike's two edits alone do not establish cross-protocol validator behavior.

## Initial live discovery

Unauthenticated checks on the owner's LAN found:

- DSM responds and advertises the required File Station list/search/upload/download/delete APIs.
- DSM HTTPS presents a certificate not trusted by this environment.
- The default WebDAV HTTPS port, 5006, refuses connections. WebDAV may be disabled or configured on another port.
- A local Tailscale device list contains a Linux peer named `fileserver`, reported offline. A direct Tailscale ping timed out. This does not establish that it is the current Synology or that its package is currently installed.

Authenticated NAS reads/writes and a NAS-side Tailscale package check have not been completed. The owner explicitly authorized reuse of the existing mount credentials after automatic review requested that authorization. The NAS then rejected SSH login with that account. HTTPS API testing awaits either explicit trust of the observed NAS certificate or a separately verified certificate. No existing property document has been changed.

## References

- [Synology File Station API guide](https://global.download.synology.com/download/Document/Software/DeveloperGuide/Package/FileStation/All/enu/Synology_File_Station_API_Guide.pdf)
- [Synology WebDAV specifications](https://www.synology.com/en-us/dsm/7.4/software_spec/webdav)
- [WebDAV standard: ETags](https://www.rfc-editor.org/rfc/rfc4918.html#section-8.6)
- [Tailscale on Synology](https://tailscale.com/docs/integrations/synology)
