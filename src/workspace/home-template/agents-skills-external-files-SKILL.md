---
name: external-files
description: Browse, read, download or write files in owner-configured NAS and external file stores. Use when a task needs documents on a connected file server, including property documents.
---

# External files

Use the `external-files` CLI through bash. Run `external-files --help` for command syntax.
`external-files stores` returns enabled stores, folder IDs and per-folder write permissions.
Use those IDs for subsequent commands; paths are relative to the selected allowed folder.

- Browse with `list`; there is no local index or synchronized cache.
- `read` returns UTF-8 content and an ETag. For PDFs or Office files, use `download`, then
  the documents skill on the returned temporary path. Remove that temporary file when finished.
- Prepare text changes in a local file, then use `write --from`. Creating a file requires
  `--create`; replacing one requires `--etag` with the strong ETag from a fresh read.
  If the ETag is weak, read again after a short delay. A conflict needs another read and review.
  Never retry a timed-out write blindly. Read back a successful write to verify it.

Text reads and writes are capped at 256 KiB; downloads at 2 MiB. Credentials stay in the gateway.
The owner manages connections and folder grants in Workspace → File stores.
