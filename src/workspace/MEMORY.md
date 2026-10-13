# Memory and evidence

The workspace keeps source evidence separate from curated memory. Recall does not depend on a background model pass.

## Immediate recall

`memory_search` searches personal topics, daily notes, user messages, assistant replies, and tool-result text.
`memory_read` returns a complete text part, provenance, adjacent part IDs, and surrounding exchange IDs.
The runtime tells chat sessions to retrieve relevant personal context before recommendations, even without an explicit recall request.

The index lives at `<agentDir>/memory-evidence.sqlite`, behind the existing agent-directory guard.
It uses SQLite FTS5 with OR terms and ranked results. Search does not use embeddings.
The host refreshes the index after each completed run and before evidence tool calls.
Session indexing resumes from the last complete JSONL line. A partial final line waits for completion.
Original session files remain unchanged. Each record has its source role and timestamp.
Only stamped user messages supply source tags for new personal facts in curated memory.

The index removes secrets before text segmentation. Long records use adjacent text parts of at most 8000 characters.
Results contain excerpts. Full reads supply the evidence used to validate background proposals.
An index generation identifies each database. A rebuilt index restarts background review instead of reusing an incompatible cursor.
Evidence IDs derive from source location and text, so unchanged records retain their IDs after an index rebuild.

Image bytes remain in original sessions or uploads. The index records an image marker but does not run OCR.
Existing document extraction text appears through tool results. One-time location results do not enter the index.
JSONL lines larger than 16 MiB exceed the parser limit. Other records remain searchable.

## Background capture and dreaming

`memory-capture` checks for new evidence every five minutes. It skips busy conversations and unchanged inputs.
`consolidation` also runs at the configured nightly time. Both jobs share one execution lock and review cursor.
Capture does not repeat nightly task upkeep or run only because a profile approaches its size cap.

Each review starts with a bounded batch of unprocessed evidence and new daily notes.
The model can search older conversations and read related topics through read-only tools.
It has no shell, write tool, connector mutation, or direct access to private agent files.
The evidence tools expose redacted source text without granting access to credentials.

The model returns proposals for `USER.md`, `MEMORY.md`, `memory/catalog.md`, and `memory/topics/<slug>.md`.
The host checks allowed paths, source citations, size caps, secrets, and concurrent edits.
Existing curated-memory checks also validate source tags, lexical grounding, and excessive entry removal.
New topic content requires evidence supplied in the batch or read through `memory_read`.
These checks establish provenance and structure. They do not prove that every inference is correct.

The host applies proposals between chat turns and requests a context reload.
It advances the evidence cursor only after an accepted application. Later batches remain pending.
Rejected proposals leave memory and the cursor unchanged. New evidence or changed memory permits another attempt.
`DREAMS.md` records applied changes, source IDs, and rejection reasons.

## Memory placement

- `USER.md`: explicit preferences, routines, and standing personal context.
- `MEMORY.md`: concise standing guidance and useful pointers.
- Topic files: specific patterns, attributed observations, decisions, and source references.
- Source records: exact dated messages and tool results, including detailed order lists.
- Catalog: short descriptions and specific conditions for reading each topic.

A purchase records an observation. It does not establish a preference or current inventory.
A pattern needs separate supporting events. Repeated assistant summaries do not count as independent observations.

## Validation

`memoryEvidence.test.ts` covers immediate retrieval, long records, corrections, redaction, pagination, partial writes, and linked-file refusal.
`dreamDocuments.test.ts` covers sourced topics, historical investigation, cursor handling, rejected paths, and concurrent edits.
Pi integration tests cover recall after reset and the background tool allowlist.
They use scripted model replies. They test system behavior, not the model's spontaneous retrieval choices or semantic accuracy.
