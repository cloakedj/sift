# Decide onboard pipeline

Labels: wayfinder:grilling
Parent: Fast Semantic Search Engine on Jev
Status: closed
Assignee: cloakedj
Blocked by: Decide semantic record schema

## Question

What should the onboarding CLI do from `onboard <path>` to a searchable local index? Decide scanning rules, chunking strategy, batching through Jev, failure/retry behavior, cache keys/source hashes, incremental re-onboarding, local storage layout, and the first pass/fail checkpoint.

## Checkpoint unlocked

A developer can run an onboarding command and verify that resource chunks have Jev-derived structured meaning stored locally.

## Resolution

Approved through live discussion. This records the pipeline contract, not an implementation.

### Discovery and privacy

- `onboard <path>` indexes a single file or recursively discovers resources in a directory; no project config or resource-type flag is required.
- Include text-like resources; skip binaries. Maintain a source-configurable denylist with additions/removals for hidden directories, dependencies, build outputs, caches, `.git`, `node_modules`, `dist`, `build`, `.next`, coverage, and the engine's own `.jev` directory.
- Exclude common confidential files such as `.env`, private keys, and credentials files by default. The user confirmed **denylist**, not mandatory allowlisting.
- Apply exclusions before content enters Jev requests, embedding providers, or receipts. Path rules cannot guarantee the absence of secrets in otherwise permitted resources.
- Large text files are streamed/chunked, not excluded solely because of size.
- Local storage does not imply offline inference: Jev classification sends permitted chunk content to TypeSafe.

### Chunking and taxonomy

- Use generic paragraph/heading-aware chunking for documents and overlapping line windows for other text/code, with a hard size cap.
- Optionally ask Jev to refine ambiguous proposed boundaries. Local code assembles bounded chunks from its judgments; on refinement failure retain deterministic boundaries. No AST dependency in the core; language-aware extraction remains a future plugin option.
- Use a two-phase flow: discover/chunk/harvest candidates globally, then Jev-govern the taxonomy and classify chunks against the resulting registry snapshot. Soft, reversible taxonomy mutation follows [Decide semantic record schema](02-decide-semantic-record-schema.md).
- Governance calls evaluate candidate pools; classification uses one request per chunk with its independent questions together, processed concurrently with bounded resource usage. Exact harvesting choices remain with [Research universal taxonomy candidate harvesting](10-research-universal-taxonomy-candidate-harvesting.md).
- Merkle-style structures are deferred change-detection optimizations, not semantic chunking or parallelism mechanisms.

### Persistence and reuse

Persist run metadata, taxonomy, semantic records with deterministic `embeddingDocument`, and append-only historical receipts:

```txt
.jev/
  index.json
  taxonomy.json
  records/<chunk-id>.json
  receipts/<run-id>.jsonl
```

- No vectors or placeholder vectors at this first checkpoint; their storage is decided in [Decide embedding and local vector backend](05-decide-embedding-and-local-vector-backend.md).
- Reuse classification only when the full classification-input fingerprint matches: chunk content and supplied context, taxonomy snapshot, question-set version, and model version.
- Track chunker and embedding-projection versions separately. Changing the projection alone must not force Jev reclassification. Keep resource/chunk hashes; defer full Merkle indexing.

### Failures and publication

- Retry transient Jev failures with backoff, then mark affected chunks unclassified and continue resumably.
- Publish successful records; explicitly record failures and run completeness. Incomplete onboarding exits nonzero.
- Never silently serve an old classification as current after its source changes.
- Receipts remain historical evidence, not a search dependency.

### First checkpoint (planned, not executed)

```bash
npm run cli -- onboard ./src --limit 5
```

For up to five chunks, write index/run metadata, taxonomy, semantic records containing `resource`, `taxonomy`, `embeddingDocument`, and `provenance`, plus append-only receipts. A rerun with unchanged classification inputs reuses records without classification calls. This proves local persistence of Jev-derived meaning; vector retrieval is a later checkpoint.

Exact candidate-harvesting choices are delegated to the research ticket; concrete budgets, tuning, and validation coverage belong in [Define development checkpoints](07-define-dev-checkpoints.md).
