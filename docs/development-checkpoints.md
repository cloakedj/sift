# Development checkpoint progress

## Resource discovery and chunk inventory — passed

`onboard --dry-run` inventories resources without creating semantic records, inferring taxonomy, embedding content, or publishing vectors. `index` and `lexical-search` are legacy lexical diagnostics, not semantic checkpoint evidence (`search` now exposes the query-intent checkpoint below).

### Commands

```bash
npm run cli -- onboard tests/fixtures/code --dry-run
npm run cli -- onboard tests/fixtures/text --dry-run
npm run cli -- onboard tests/fixtures/mixed --dry-run
npm run --silent cli -- onboard --root tests/fixtures/mixed --dry-run --json
npm run cli -- onboard . --dry-run
npm test
npm run typecheck
npm run build
```

Mixed fixture output: two resources and three chunks. JSON includes resources, source-linked chunks, exclusions, failures, completeness, chunker version, and limits. Use npm's `--silent` option when piping JSON to another process. Credentials and `.env` are not required for dry runs. Non-dry-run onboarding now performs real Jev inference (see the next checkpoint below).

### Implemented contract

- Discover one file or recursively traverse a directory in sorted order; do not follow symlinks.
- Apply the source-configurable policy in `src/inventory/consts.ts` before reading content. Defaults deny hidden directories, dependencies/build outputs, `.jev`, common credential files, private keys, and known binary extensions. Policy sets and patterns can be replaced or extended; no configuration-file syntax is introduced yet.
- Stream input, including files over 2 MB. Accept UTF-8 text; reject invalid UTF-8 and binary control bytes, discarding all proposed chunks even when detection happens late. Empty files are resources with no chunks.
- Bound chunks to 8,192 bytes and 48 lines. Markdown/plain-text/RST documents prefer paragraph and Markdown heading boundaries; other text uses line windows with up to eight overlapping lines. Long lines split on UTF-8 boundaries. Byte ranges are half-open and preserve original line endings; line ranges are inclusive and one-based.
- Resource identity hashes the absolute file URI. Chunk identity hashes resource identity, chunker version, byte range, and content hash. Repeated unchanged scans at the same location are deterministic. Moving the root intentionally changes identity; no relocation guarantee is made.
- Report read failures and exit nonzero for incomplete inventories. Skipped resources are distinct from failures. Dry runs do not write local artifacts, instantiate inference clients, or call providers.

The input reader is streaming, but the returned inventory (including chunk text) is materialized in memory. This is not yet a scale/performance guarantee. Path exclusions cannot detect secrets inside otherwise permitted text. UTF-16 and other legacy encodings are not supported by this first implementation.

### Validation evidence

- Eight automated tests passed: all three fixture scopes through the product CLI, identity stability, no writes, source-policy overrides, privacy exclusions, binary/invalid-UTF-8 rejection, symlink avoidance, empty files, paragraph boundaries, overlapping windows, byte/source/hash fidelity, Unicode lines in a resource over 2 MB, source changes, and invalid command failures.
- Typecheck and production build passed.
- Repository dry-run smoke test passed with no read failures, inference calls, or publication.
- No Jev or Cloudflare checks were run or claimed at this checkpoint.

## Coding standards and messages

`AGENTS.md` records the directory-scoped organization and messaging rules. Related source lives under `cli/`, `errors/`, `filesystem/`, `inventory/`, `lexical/`, `messages/`, `onboarding/`, `runtime/`, `taxonomy/`, and `typesafe/`; each scope extracts shared types/constants/utilities where needed.

`src/messages` is the only console boundary. `report({ label: "Scenario", level: "info", text, tags: ["summary"] })` renders `Scenario: [Info] …`. Tags remain structured metadata for future styling; the sink is replaceable. JSON goes through the same service without labels, and diagnostics use stderr in JSON mode. Provider failures also route through it. SDK logging is disabled entirely so no SDK output bypasses the service.

### Errors, Effect, and class-based services

- `src/errors` owns the `ErrorDetails` contract, code registry, `AppError`, and `Errors` factory. Errors carry code, reason, message, metadata, and retryability. `Errors.fail` is the normal Effect failure path; synchronous parser guards use `Errors.raise` inside a normalized boundary. Reports and receipts serialize the same contract without raw stacks/provider bodies/credentials. Historical string errors remain readable.
- Application services are classes with private `_`-prefixed members. Pure deterministic transformations stay in scoped utilities. There are no JavaScript `#` members or ad hoc native error constructors in application code.
- Service methods return typed Effects. `Context`/`Layer` supplies filesystem, inventory, stores, inspection, lexical diagnostics, Jev, taxonomy, onboarding, and messaging. Credential-free commands do not acquire provider configuration. Promise adaptation is confined to external APIs and runtime/test entry points.
- Onboarding uses structured `Effect.forEach` concurrency. Scoped `acquireRelease` owns locks, temporary files, and resource streams; receipt appends use an Effect semaphore. Cancellation aborts provider requests and releases owned resources only after in-flight mutations settle. A failed lock acquisition never releases someone else's lock.
- Effect manages provider timeouts and bounded exponential retries; SDK retries are disabled to avoid nested retry loops. Permanent HTTP errors do not retry. SIGINT/SIGTERM interrupt the root effect; forced termination still needs manual stale-lock recovery.
- Validation: **28 tests passed**, plus typecheck and build. New tests cover structured-error redaction/reporting, transient/permanent retries, cancellation, cleanup after partial writes, lock ownership, and lightweight coding-standard guardrails. All three existing real-service fixture caches survived the refactor: 8 records reused, zero classifications, and no run failures. This cache check is not a new real-inference quality measurement.

The legacy lexical diagnostic now uses `.jev/lexical-index.json` so it cannot overwrite semantic state. Rebuild old diagnostic indexes with `index`; no semantic search behavior is claimed yet.

## Jev semantic records — passed on small fixtures

### Commands

```bash
npm run cli -- onboard tests/fixtures/code
npm run cli -- onboard tests/fixtures/text
npm run cli -- onboard tests/fixtures/mixed
npm run --silent cli -- inspect records --root tests/fixtures/mixed --json
npm run --silent cli -- inspect taxonomy --root tests/fixtures/mixed --json
# Repeat onboard to verify reuse.
```

Non-dry-run onboarding sends permitted content to TypeSafe and incurs inference usage. It requires `TYPESAFE_API_KEY` and a pinned model (`jev-1.13.0` by default; override with `TYPESAFE_DEFAULT_MODEL`). Effect retries transient failures with bounded exponential backoff and per-attempt timeouts; SDK retries are disabled. No Cloudflare work or vector publication occurs yet.

### Implemented contract

- Harvest language-light candidates globally, independently govern each proposed label/dimension, then classify each chunk against the resulting snapshot. Pending, unsuitable, failed, overflow, and promoted outcomes remain distinct and inspectable.
- Candidate caps, rare-label reservation, independent-choice governance, confidence threshold, and serialized request guards follow the approved initial policy. Tuning defaults remain uncalibrated. Conservative YAML front matter supports the selected string/string-list fields; unsupported syntax warns rather than excluding the resource.
- Persist `.jev/index.json`, `.jev/taxonomy.json`, `.jev/records/<chunk-id>.json`, and append-only `.jev/receipts/<run-id>.jsonl`. Files publish by atomic rename; a single-writer lock protects each state directory. An interrupted run may require removing its lock after verifying the process is no longer running; completed records/judgments are reused on the next run.
- Classification fingerprints cover the full request (content and supplied resource context, questions, pinned model) plus taxonomy snapshot and question-set version. Projection-only changes recompute the embedding document without inference. Successful response model, answer types, scores, confidence, and probability distributions are validated.
- Records carry source URI, original byte/line ranges, source/chunk hashes, Jev label scores, deterministic embedding documents, model/version provenance, and receipt references. Successful records remain available in a visibly incomplete run; failures are never replaced with lexical results.
- Changed/deleted source is excluded from current `inspect records` output. Historical record files/receipts are retained, not silently treated as current. Inspection never performs inference or mutates records.
- `--limit N` bounds classification only, **not global taxonomy harvesting/governance**. Deferred chunks mark the run incomplete and exit nonzero. Use small fixture roots to bound paid proof runs. `--rerun-governance` explicitly reconsiders pending/unsuitable judgments; overflow is not automatically drained.
- Inspect JSON reports missing/stale records and completeness; missing credentials, invalid arguments, read failures, failed inference, and incomplete runs exit nonzero.

### Real-service evidence

Actual product commands against Jev `jev-1.13.0` completed for all three fixture scopes. Every record passed the source-linked inspection view, with no failed judgments/classifications:

| Scope | Semantic records | Selected candidates | Promoted dimension-labels | Unchanged rerun |
| --- | ---: | ---: | ---: | --- |
| Code | 1 | 27 | 1 | 1 reused, 0 classified |
| Text | 4 | 49 | 0 | 4 reused, 0 classified |
| Mixed | 3 | 76 | 6 | 3 reused, 0 classified |

Rerun receipts contain only start/reuse/finish actions: no new governance or classification. Raw local proof artifacts live in each fixture's ignored `.jev/` directory. Counts are observed outcomes, not assertions of repeatable model outputs or retrieval relevance.

**Quality finding:** the text fixture promoted no discovered taxonomy labels at the approved 0.8 threshold; its records have Jev resource-kind judgments but empty label arrays. Do not treat successful persistence as proof of useful semantic retrieval. The next taxonomy/classification checkpoint must inspect candidate quality, pending judgments, and classification usefulness before any calibration change.

Credential-free tests separately cover controlled provider failures, resumability, pending judgments, malformed answers, concurrency/locks, cache invalidation, projection-only reuse, source changes/deletion, exclusions, and clean JSON/error output. These do not substitute for the real-service evidence above. No Cloudflare checks were run.

## Taxonomy and classification validation — quality gate still open

The pipeline and `inspect taxonomy` view are implemented as prerequisites to semantic records. The dedicated next gate is quality validation of candidate evidence, selected/overflow pools, pending/promoted judgments, and chunk classifications across scopes, including the zero-promoted-label text result. This is not a second classification pipeline.

### In-progress validation view

`inspect validation` now summarizes the existing local semantic artifacts without inference or mutation:

```bash
npm run --silent cli -- inspect validation --root tests/fixtures/mixed --json
```

The report includes selected candidate evidence counts/sources/examples, overflow/excluded counts, per-dimension promoted/pending/unsuitable/failed judgment counts, current record completeness, resource-kind counts, positive label assignments, chunks with no positive taxonomy label scores, and findings for incomplete records, failed/pending governance, dimensions with no promoted labels, and promoted labels that were never assigned. This is a manual quality-inspection aid, not a calibrated pass/fail gate yet.

Validation: 28 credential-free tests passed, plus typecheck and build. A local mixed-fixture cache inspection reported complete records with pending governance findings and no new provider calls. No new real-service Jev or Cloudflare evidence is claimed for this validation-view change. A subsequent correction counts normalized score 1 (not 2) as the central endpoint; intermediate positive scores count as secondary in this diagnostic summary, not as calibrated relevance categories.

## Query intent — implemented; real-service mechanics demonstrated

```bash
npm run --silent cli -- search 'find session expiry checks without permission checks' --root tests/fixtures/code --show-intent --json
npm run --silent cli -- search 'explain how expired sessions are rejected' --root tests/fixtures/text --show-intent --json
npm run --silent cli -- search 'find bounded retries without permanent rejection' --root tests/fixtures/mixed --show-intent --json
```

### Contract

- `src/intent` extracts at most 24 unique unigram/bigram candidates from a query bounded to 2,048 UTF-8 bytes. Jev chooses intent kind, optional answer shape, phrase roles, and independent positive taxonomy scores. Requests are capped at 32 KiB; oversized registries fail explicitly rather than silently dropping labels.
- Negative signals are soft preferences, not filters. Unmatched candidates remain available for future enrichment without mutating the taxonomy. Embedding documents include raw query, kind, optional shape, positive terms, and positive taxonomy scores in stable order. Negative fields are not appended as positive targets; the original query can itself contain negation.
- Cache entries under `.jev/intent/` are atomic, separate from semantic records and receipts, and keyed by exact raw query, registry version, pinned model, question-set version, and the full request. Cached structured answers are validated against current questions before reconstructing intent. Invalid structured answers require fresh inference; malformed JSON fails explicitly. Cache hits acquire no provider credentials. Query caches contain raw query-derived terms and should be treated as local sensitive state.
- Misses require Jev and use the existing Effect retry/timeout/cancellation boundary. Provider failures never become lexical results. Search only exposes `--show-intent` for now and explicitly returns `retrieval: "not-implemented"`; normal semantic retrieval remains unavailable. The old diagnostic search is now explicitly `lexical-search`.
- Intent confidence is the Jev kind-choice confidence, not search-result confidence. Phrase extraction and positive-score projection are initial, uncalibrated policies.

### Evidence and limitations

All three commands above completed fresh inference against `jev-1.13.0`. Repeating each with `TYPESAFE_API_KEY=''` returned identical intent with `reused: true`.

| Scope | Observed kind | Kind confidence | Notes |
| --- | --- | --- | --- |
| Code | `find_risk` | 0.50 | Permission phrases separated as negative signals; kind is debatable for an implementation-oriented query. |
| Text | `find_explanation` | 1.00 | Explanation shape selected; taxonomy remains empty, so intent is phrase-based. |
| Mixed | `find_configuration` | 0.48 | Permanent-rejection phrases separated as negatives; retry labels scored positively. |

These are real feature observations, not a calibrated semantic-quality or retrieval pass. Extraction retained generic words such as “find” and “how”; intent-kind ambiguity and taxonomy usefulness remain open quality findings. No thresholds were tuned to these outputs. Local ignored `.jev/intent/` artifacts retain the structured responses for inspection. No Cloudflare requests were made.

Credential-free validation: **29 tests passed**, typecheck and build passed. Tests cover deterministic projection/cache reuse without credentials, query/model/registry invalidation, invalid cached answers, malformed provider answers, query bounds, explicit missing-provider failure, JSON CLI output, and negative-field separation. Existing shared-provider tests separately cover retries and cancellation.

## Next feature checkpoint — Cloudflare embedding and publication

Workers AI embeddings, Vectorize publication, and `status` visibility/completeness are not implemented. The taxonomy quality gate and intent-quality findings above remain open; moving forward must not be reported as resolving them.
