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

The model returns structured additions, replacements, removals, and topic links for curated memory.
Each edit names existing entry IDs and source IDs. Unmentioned entries remain unchanged, including older entries with unusual source tags.
The host renders citations and inference labels. It checks allowed paths, source existence, size caps, secrets, and concurrent edits.
One source can support several entries. Topic links require an existing or proposed destination, rather than a conversation citation.
Topic documents still use full-file proposals. New topic content requires evidence supplied in the batch or read through `memory_read`.

The OpenRouter Decisions API reviews each edit and document against the supplied evidence.
It checks meaning, attribution, negation, temporal corrections, and distinctions between facts, observations, and inferences.
The reviewer returns typed probabilities and has no tools. Every proposed change requires a decision.
The host accepts a change only when its support probability is at least 0.90.
The previous 0.95 threshold rejected edits with scores such as 0.9444.
This provisional threshold needs evaluation against labeled memory changes. It does not guarantee 90% accuracy.
Lowering the threshold reduces rejections but can admit more unsupported changes.
Missing, duplicate, or invalid decisions cannot authorize a write. Word overlap and source-use counts do not decide factual support.
Capture gets one repair attempt after a structural or semantic rejection.
API failures and invalid review responses stop the attempt and keep the evidence pending.
The complete update must pass before application, so a topic and its index cannot become inconsistent.
Unresolved rejection leaves all evidence pending. There is no partial application in this protocol.

The reviewer is fallible. This design separates structural guarantees from semantic judgments rather than claiming to prove truth.
Review uses the OpenRouter key, even when chat uses a ChatGPT sign-in.
The selected decision provider receives the review evidence through OpenRouter.
The default reviewer is `perplexity/pplx-decider-v1.1-27b`.
Set `WORKSPACE_MEMORY_REVIEW_MODEL` to another Decisions API model, such as `typesafe/jev-1.13` or `microsoft/microsoft-decision-1`.
The endpoint uses `OPENAI_BASE_URL`, with `/v1` replaced by `/alpha/decisions`. Custom gateways must support this route.
Run logs record the reviewer model, token usage, cost, and acceptance count when available.
The proposal model still writes JSON updates. Proposal errors and review errors have separate failure messages.
The old whole-file protocol remains available to internal callers without a review callback. Production always supplies the callback.

The host applies proposals between chat turns and requests a context reload.
It advances the evidence cursor only after an accepted application. Later batches remain pending.
Rejected proposals leave memory and the cursor unchanged. New evidence or changed memory permits another attempt.
Structured capture also retries unchanged rejected inputs after 30 minutes. This prevents transient reviewer failures from blocking capture indefinitely.
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

## Semantic review evaluation

`memoryUpdates.test.ts` checks structured edits, citations, review coverage, repair, topic links, and concurrent changes with scripted replies.
These tests verify the pipeline. They do not measure a model's semantic accuracy.

The synthetic cases in `fixtures/memory-review.ts` cover paraphrases, negation, attribution, purchases, corrections, temporary travel, and inferences.
Run `bun scripts/eval-memory-review.ts --list` to inspect the cases without model calls.
With an OpenRouter key in `OPENAI_API_KEY`, run `bun scripts/eval-memory-review.ts` to evaluate the configured `WORKSPACE_MEMORY_REVIEW_MODEL` through the Decisions API.
The evaluation uses temporary storage and synthetic data. It reports false acceptances, false rejections, and errors separately.
It makes paid model calls. A passing small fixture set does not establish production accuracy.

## Design sources

- [Letta memory and dreaming](https://docs.letta.com/configuration/memory) describes model-managed persistent memory and background refinement.
- [Mem0 extraction](https://docs.mem0.ai/core-concepts/memory-operations/add) uses model extraction with retained conversation context.
- [LongMemEval](https://arxiv.org/abs/2410.10813) evaluates extraction, reasoning, temporal updates, and abstention.
- [Selection versus extraction with Jev](https://arxiv.org/abs/2609.34227) studies raw-turn selection under different context budgets.
  Its results concern retrieval selection, not factual verification. They support retaining raw evidence alongside curated memory.
- [TypeSafe Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) provides typed decisions with confidence estimates.
  A confidence estimate alone does not establish correctness on personal-memory updates.
