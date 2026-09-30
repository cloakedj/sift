# Development checkpoint progress

## Repository configuration and Sift naming — credential-free mechanics

`onboard` now automatically reads `sift.config.json` at the selected root. Shared discovery applies include/exclude globs, optional root/nested `.gitignore` rules, and safety defaults across onboarding and later source-current checks. CLI/programmatic onboarding options override config defaults. `--config` supports explicit config selection across corpus commands. See [configuration](configuration.md) for the contract and migration steps.

Local state is now `.sift/`, and the repository retrieval skill is named `sift`. Existing local stores in this checkout were renamed without modifying their contents. State paths below use the current name; historical provider model names, remote index names, and temporary evidence paths are unchanged. No new real-service semantic checkpoint is claimed for configuration or this rename.

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
- Apply the source-configurable policy in `src/inventory/consts.ts` before reading content. Defaults deny hidden directories, dependencies/build outputs, `.sift` (and legacy state), common credential files, private keys, and known binary extensions. Source policy sets and patterns can be replaced or extended. Repository configuration now adds file-selection rules; see the configuration checkpoint above.
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
- Effect manages provider timeouts and bounded exponential retries; SDK retries are disabled to avoid nested retry loops. Permanent HTTP errors do not retry. SIGINT/SIGTERM interrupt the root effect; forced termination can leave a stale lock; after confirming no writer is active, recover with `onboard --resume` or manual lock removal.
- Validation: **28 tests passed**, plus typecheck and build. New tests cover structured-error redaction/reporting, transient/permanent retries, cancellation, cleanup after partial writes, lock ownership, and lightweight coding-standard guardrails. All three existing real-service fixture caches survived the refactor: 8 records reused, zero classifications, and no run failures. This cache check is not a new real-inference quality measurement.

The legacy lexical diagnostic now uses `.sift/lexical-index.json` so it cannot overwrite semantic state. Rebuild old diagnostic indexes with `index`; no semantic search behavior is claimed yet.

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
- Persist `.sift/index.json`, `.sift/taxonomy.json`, `.sift/records/<chunk-id>.json`, and append-only `.sift/receipts/<run-id>.jsonl`. Files publish by atomic rename; a single-writer lock protects each state directory. An interrupted run may require `onboard --resume` (or manual lock removal) after verifying the process is no longer running; completed records/judgments are reused on the next run.
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

Rerun receipts contain only start/reuse/finish actions: no new governance or classification. Raw local proof artifacts live in each fixture's ignored `.sift/` directory. Counts are observed outcomes, not assertions of repeatable model outputs or retrieval relevance.

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
- Cache entries under `.sift/intent/` are atomic, separate from semantic records and receipts, and keyed by exact raw query, registry version, pinned model, question-set version, and the full request. Cached structured answers are validated against current questions before reconstructing intent. Invalid structured answers require fresh inference; malformed JSON fails explicitly. Cache hits acquire no provider credentials. Query caches contain raw query-derived terms and should be treated as local sensitive state.
- Misses require Jev and use the existing Effect retry/timeout/cancellation boundary. Provider failures never become lexical results. At this checkpoint search only exposed `--show-intent`. The retrieval checkpoint below now adds normal search; `--show-intent` remains intent-only and returns `retrieval: "not-requested"`. The old diagnostic search is explicitly `lexical-search`.
- Intent confidence is the Jev kind-choice confidence, not search-result confidence. Phrase extraction and positive-score projection are initial, uncalibrated policies.

### Evidence and limitations

All three commands above completed fresh inference against `jev-1.13.0`. Repeating each with `TYPESAFE_API_KEY=''` returned identical intent with `reused: true`.

| Scope | Observed kind | Kind confidence | Notes |
| --- | --- | --- | --- |
| Code | `find_risk` | 0.50 | Permission phrases separated as negative signals; kind is debatable for an implementation-oriented query. |
| Text | `find_explanation` | 1.00 | Explanation shape selected; taxonomy remains empty, so intent is phrase-based. |
| Mixed | `find_configuration` | 0.48 | Permanent-rejection phrases separated as negatives; retry labels scored positively. |

These are real feature observations, not a calibrated semantic-quality or retrieval pass. Extraction retained generic words such as “find” and “how”; intent-kind ambiguity and taxonomy usefulness remain open quality findings. No thresholds were tuned to these outputs. Local ignored `.sift/intent/` artifacts retain the structured responses for inspection. No Cloudflare requests were made.

Credential-free validation: **29 tests passed**, typecheck and build passed. Tests cover deterministic projection/cache reuse without credentials, query/model/registry invalidation, invalid cached answers, malformed provider answers, query bounds, explicit missing-provider failure, JSON CLI output, and negative-field separation. Existing shared-provider tests separately cover retries and cancellation.

## Cloudflare embedding and publication — small-fixture metadata and reconciliation proof passed

Publication mechanics, service-compatible metadata, reconciliation snapshots, and small-fixture visibility are demonstrated. `publish` requires source-current complete records and takes the semantic-store writer lock. A deterministic generation fingerprint covers source root, target account/index, pinned embedding configuration, semantic record schema/provenance, classifications, and projection documents. Each generation has isolated vector IDs and a namespace; unchanged reruns reuse validated embedding caches and remotely verified vectors. Missing or mismatched vectors are re-upserted even if a prior mutation was accepted. Cache writes precede upserts, so interrupted requests can safely repeat idempotent mutations.

Before embedding, publication verifies the remote index uses 768 dimensions and cosine distance. After upserts it polls each vector via a namespace-scoped self-query (at most twelve rounds, exponential delays capped at thirty seconds). Only observed expected IDs in the expected namespace count as visible. Missing visibility leaves publication `pending` with nonzero exit. Completion requires every vector to be query-visible and a final source/projection currency check. Remote transient failures receive at most two retries, with per-attempt timeouts and cancellation. Partial state, mutation IDs, and embeddings remain available for resumption.

`status` remains credential-free and checks current local sources/projections against the publication fingerprint. It reports expected/submitted/visible/missing counts and the last verification timestamp, not live remote health. It exits zero only for a source-current verified publication; stale sources deactivate the reported embedding space. It also exposes the last reconciliation snapshot: missing and metadata-mismatched expected IDs, extra IDs in the current namespace, and stale IDs in superseded corpus namespaces. Stale vectors outside the current namespace are retained and warned about; they do not invalidate a complete current generation.

```bash
npm run cli -- publish --root tests/fixtures/mixed
npm run --silent cli -- status --root tests/fixtures/mixed --json
```

Paid staging requires `CLOUDFLARE_VECTORIZE_INDEX`. Authentication can use either explicit `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`, or a local `npx wrangler login` session. The CLI captures `wrangler auth token --json` in memory, delegates credential storage/refresh to Wrangler, and never prints or persists that token. Explicit environment credentials take precedence. With no explicit account, `wrangler whoami --json` must identify exactly one account; multiple accounts require `CLOUDFLARE_ACCOUNT_ID`. Credential-free status does not invoke Wrangler. Wrangler is pinned as a development dependency for this development CLI.

```bash
npx wrangler login
CLOUDFLARE_VECTORIZE_INDEX=jev-checkpoint npm run cli -- publish --root tests/fixtures/code
```

The model is pinned to `@cf/baai/bge-base-en-v1.5`, 768 dimensions, `cls` pooling, cosine metric. A conservative 500-UTF-8-byte preflight guard rejects overlength documents rather than risking silent truncation; this may block existing fixture projections and needs a tokenizer-backed policy before useful-scale validation.

Initial implementation had no Cloudflare credentials; the subsequent Wrangler-authorized evidence is recorded below. Public REST schemas for [index configuration](https://developers.cloudflare.com/api/resources/vectorize/subresources/indexes/methods/get/) and [query](https://developers.cloudflare.com/api/resources/vectorize/subresources/indexes/methods/query/) were checked during implementation. Credential-free validation: 35 tests, including malformed responses, wrong dimensions, wrong namespaces, transient/permanent failures, cached resume after failed upsert, unchanged reruns, and stale-source deactivation. These are mechanics tests, not semantic evidence.

Still needed: tokenizer-backed bounds, query/document embedding-space compatibility enforcement at retrieval, explicit namespace cleanup, metadata-filter indexes when filters are introduced, and semantic query retrieval. Self-query top-100 checks are deliberately conservative and can remain pending for large identical-vector groups; this is not a scale guarantee. Reconciliation scans at most 100 pages of 1,000 IDs in the shared index, batches direct gets by 20, and includes expected/prior IDs independently of the eventually consistent listing. It is a timestamped observation, not a transactional or continuous remote-health guarantee. Old namespaces/caches are retained; no remote deletion is implemented. The taxonomy quality gate and intent-quality findings above remain open.

### Wrangler-authorized real-service evidence

On 2026-09-18, Wrangler browser OAuth was used to create `jev-checkpoint` (768/cosine) and run the product `publish` command against all three fixture scopes. Real Workers AI BGE base/CLS responses produced validated 768-dimensional vectors. Vectorize accepted mutations with minimal `chunkId` metadata; subsequent namespace-scoped self-queries returned every expected vector. All three credential-free `status` commands then exited zero with no missing vectors.

| Scope | Expected | Submitted | Query-visible | Missing |
| --- | ---: | ---: | ---: | ---: |
| Code | 1 | 1 | 1 | 0 |
| Text | 4 | 4 | 4 | 0 |
| Mixed | 3 | 3 | 3 | 0 |

Initial publication attempts correctly remained pending. The first code mutation became query-visible several minutes after submission; the original fifteen-second backoff window was insufficient. Polling was expanded, but remains bounded and cancellable. Pending reruns reused local embeddings and accepted mutations. One additional idempotent code-vector upsert was performed directly through Wrangler while diagnosing delay; index info later showed the original product mutation processed. `wrangler vectorize info` counters lagged query visibility and were not used as proof of completeness.

These are real publication/visibility observations, not semantic relevance evidence: the probes use each stored vector itself, not a new Jev query intent. In particular, multiple text records have identical projection documents; retrieving them does not demonstrate discrimination. The remote index and ignored fixture `.sift/` caches/manifests are retained for the next stage. Tokens are not stored in those artifacts or committed files.

### Service-compatible metadata and reconciliation evidence

On 2026-09-19, product `publish` runs upgraded all three scopes to manifest schema 3 and new isolated generations. Remote metadata now contains hashed corpus/resource/chunk identities, semantic-record schema version, embedding-space ID, content hash, and semantic-record hash. It contains no source text, raw paths, or credentials. Embedding-space identity covers provider/model, dimensions/metric/pooling, preprocessing/role policy, record schemas and projection versions, separately from generation identity. These metadata fields are stored and verified; metadata-filter indexes are not yet needed or provisioned.

| Scope | Current visible | Missing | Metadata mismatch | Current extras | Superseded retained |
| --- | ---: | ---: | ---: | ---: | ---: |
| Code | 1 | 0 | 0 | 0 | 2 |
| Text | 4 | 0 | 0 | 0 | 8 |
| Mixed | 3 | 0 | 0 | 0 | 6 |

All expected metadata was read back through Vectorize `get_by_ids`, in addition to successful self-query visibility. The first live attempt returned HTTP 400 because the get request used an array instead of `{ ids }`; the adapter was corrected and a regression test added. A further refinement hashes the entire semantic record excluding run/receipt bookkeeping, and includes that hash in generation identity. Final verification therefore retains both the original minimal-metadata and intermediate metadata generations as stale. A larger shared-index get also returned HTTP 400; reducing get batches to 20 resolved it, and the client now rejects larger batches locally. Stale IDs from the previous generations were recognized without treating other fixture corpora as owned data. No vectors were deleted. Controlled tests separately prove missing-vector and wrong-metadata repairs from cached embeddings, pagination/cursor-loop rejection, extra-vector classification, and isolation from unrelated corpora. Destructive remote repair injection was not run or claimed.

## Semantic retrieval — real-service mechanics demonstrated; relevance gate still open

`search "<query>" --explain` now embeds Jev-derived query intent and queries the current publication namespace. Plain search prints source-linked previews; `--explain` includes intent, raw cosine scores, classifications, provenance, generation and embedding configuration. `--json` emits structured results. `--show-intent` remains a separate intent-only diagnostic; it cannot be combined with retrieval options.

```bash
CLOUDFLARE_VECTORIZE_INDEX=jev-checkpoint npm run --silent cli -- search 'revoke a user session' --root tests/fixtures/code --explain --json
CLOUDFLARE_VECTORIZE_INDEX=jev-checkpoint npm run --silent cli -- search 'restore access after verifying identity' --root tests/fixtures/text --explain --json
CLOUDFLARE_VECTORIZE_INDEX=jev-checkpoint npm run --silent cli -- search 'retry temporary failures with a bounded delay' --root tests/fixtures/mixed --explain --json
```

### Contract and limitations

- Search requires complete source-current records and a verified schema-3 publication. It checks namespace, corpus identity, model/provider/dimensions/pooling/metric, embedding-space identity and configured account/index; verifies the remote index; then uses the existing identity-preprocessing, symmetric BGE/CLS policy. No new query prefix or alternate model is silently introduced.
- `--top-k` defaults to 8 and accepts 1–50. Matches are sorted by descending cosine score with vector-ID tie-breaking and deduplicated. Each returned ID must map to a current local record, and its namespace and all expected publication metadata must match. Invalid remote matches fail the whole search rather than leaking stale results or reporting a successful empty answer.
- Sources/projections and publication generation are checked again after the remote query. This is a bounded currency check, not transactional source locking or a continuous remote-health guarantee. No vector writes/deletions occur during search. Query intent caches still write locally; query embeddings are not cached yet.
- The conservative 500-byte embedding guard also applies to the query projection. The Cloudflare adapter independently enforces that UTF-8 byte bound for every input and the local 16-input batch limit before any request; blank inputs fail, and empty batches return without provider calls. Credential-free boundary tests cover exact-limit ASCII/multibyte inputs, oversized inputs/batches, and zero calls for invalid batches. The adapter now also validates with the pinned local upstream BGE tokenizer (see below); the byte guard remains in force because hosted tokenizer parity is not verified. Oversized projections fail rather than truncate. A cached Jev intent avoids inference but **does not make search offline**: Workers AI embedding and Vectorize querying still incur service usage.
- Scores are vector similarity, **not search confidence**. No relevance threshold, abstention model, Jev reranking or separate negative-signal penalty is implemented. Negatives are preserved in intent and explicitly warned about, never applied as hard filters. Identical record projections produce a warning because vectors cannot distinguish them. No lexical fallback is used.

### Real-service evidence

The three commands above each completed fresh Jev `jev-1.13.0` inference (`reusedIntent: false`), real Workers AI query embedding and real namespace-scoped Vectorize retrieval against the retained fixture publications. These were new query vectors, not publication self-queries. Existing intent-checkpoint queries were also exercised using cached real Jev intent and new Cloudflare embeddings.

| Scope/query | Observed result | Quality assessment |
| --- | --- | --- |
| Code: revoke a user session | `session.ts:1–3`, rank 1, cosine 0.5816616 | Relevant implementation, but a one-record corpus cannot prove discrimination. |
| Text: restore access after verifying identity | Four chunks tied at 0.47944596; the relevant `handbook.md:7` appeared third | **Not a relevance pass.** Identical embedding documents make ranking arbitrary; the text taxonomy still has no promoted labels. |
| Mixed: retry temporary failures with a bounded delay | `operations.txt:3–4` first at 0.6500303; heading second; `queue.ts:1–3` third at 0.63876563 | Relevant guidance first, but the implementation-oriented intent did not favor code over a generic heading. |

The earlier expiry query also returned the sole code record even though that function deletes a session and does not check expiry. This demonstrates why a nonempty vector response cannot be treated as a confident answer. No thresholds or fixtures were changed to make these observations pass. Fresh intent responses are retained in ignored fixture `.sift/intent/` caches. Fixture source content and published records/vectors were unchanged by these searches.

Credential-free validation: **37 tests passed**, plus typecheck, build, lint and formatting checks. Tests separately cover source-linked retrieval using cached controlled intent, real-adapter request shape and response validation, top-k/vector bounds, corrupt remote metadata, wrong namespace, incompatible embedding identity, account/index configuration mismatch, stale sources and source mutation during a remote query. These tests establish mechanics, not relevance.

## Opt-in Jev candidate reranking — small-fixture improvement demonstrated

Investigation of the retained text taxonomy found 73 pending judgments and 221 unsuitable judgments, with zero promotions. Some candidates were judged useful but remained below the approved 0.8 confidence threshold: `restore access` scored 0.78 for concepts and 0.77 for operations; `active sessions` scored 0.75 for concepts. No threshold was lowered, pending candidate silently promoted, source fixture modified, or raw source appended to the embedding projection. The underlying empty-label/identical-projection issue remains open.

Instead, the documented direct candidate-scoring step is now exposed explicitly:

```bash
CLOUDFLARE_VECTORIZE_INDEX=jev-checkpoint npm run --silent cli -- search 'restore access after verifying identity' --root tests/fixtures/text --rerank --explain --json
CLOUDFLARE_VECTORIZE_INDEX=jev-checkpoint npm run --silent cli -- search 'find session expiry checks without permission checks' --root tests/fixtures/code --rerank --explain --json
CLOUDFLARE_VECTORIZE_INDEX=jev-checkpoint npm run --silent cli -- search 'retry temporary failures with a bounded delay' --root tests/fixtures/mixed --rerank --explain --json
```

### Contract

- `--rerank` is opt-in and evaluates at most eight candidates with concurrency three. It requires `--top-k` in 1–8; requesting more fails before provider calls. Initially each candidate incurred fresh inference; the cache checkpoint below supersedes that behavior. Ordinary search remains vector-only.
- The reranker rediscovers full current source chunks and checks chunk/resource hashes, rather than scoring the 240-character preview. It sends those candidate chunks to TypeSafe, together with structured intent and negative preferences. No source content is added to Cloudflare vectors or metadata. Requests have a 32-KiB preflight guard; no truncation or partial result is substituted for failure.
- Jev independently scores how well each chunk supports the query on a three-level rubric: unsupported, related but insufficient, directly supportive. Prompts explicitly reject imagined surrounding behavior and source/query instructions. Negative signals are soft preferences, not filters.
- Results sort by normalized Jev relevance, then original cosine similarity, then vector ID. `score` retains its original cosine meaning; `relevance` carries the separate normalized judgment, model confidence, probabilities, pinned model, question-set version and full-request fingerprint. `ranking` identifies `vector` or `jev-relevance`.
- Provider validation, retry/timeouts and cancellation use the existing Jev boundary. Missing credentials, malformed answers, provider failures and source/publication changes fail explicitly—no silent vector-only fallback after requesting reranking. Retrieval rechecks publication/source currency after inference before reporting results.
- Neither the relevance score nor Jev's judgment confidence is calibrated search confidence. All candidates remain visible: no abstention threshold is introduced. Reranking can only reorder the retrieved shortlist; it cannot rescue a relevant chunk omitted by top-k, especially in larger identical-vector groups.

### Real-service comparison

All three commands above reused the previous real Jev query intents, generated fresh Workers AI query embeddings, queried Vectorize, and performed **eight fresh Jev candidate judgments** in total. Model: `jev-1.13.0`. Fixture publications were not modified.

| Query/scope | Vector-only ordering | Observed reranked outcome |
| --- | --- | --- |
| Restore access / text | Four equal cosine scores (0.47944596), relevant line 7 third | `handbook.md:7` first, relevance 0.96; recovery heading 0.35, title 0.26, session invalidation 0.255. |
| Bounded retry delay / mixed | Guidance, generic heading, retry implementation | Guidance 0.945, `queue.ts:1–3` 0.815, heading 0.22. |
| Session expiry checks / code | Sole session-deletion function returned at cosine 0.5701791 | Relevance 0.29: no expiry-check behavior in the source. It is still returned, because no abstention policy is calibrated. |

These are observed improvements on tiny known fixtures, not a general relevance pass or evidence that taxonomy discrimination has been repaired. The mismatch query also demonstrates the remaining need for an explicit no-answer policy. No decision threshold was tuned to these scores.

Credential-free validation: **38 tests passed**, plus typecheck, build, lint and formatting checks. Tests separately cover full-source scoring beyond preview bounds, deterministic ordering/provenance, uncached calls, bounded concurrency, malformed/provider failures, model mismatch, request/candidate bounds, stale sources, and explicit credential failure when reranking is requested. They are mechanics tests, not substitutes for the live comparison.

## Reranking judgment cache — implemented; repeated live search verified

- Validated judgments are atomically persisted under `.sift/reranking/<fingerprint>.json`. The fingerprint covers the entire exact request (pinned model, full chunk text/media type, structured query intent, untrusted-input policy, question and rubric) plus question-set version. Source identity, vector order and cosine scores are not inference inputs; unchanged judgments can survive publication changes when the actual request is unchanged.
- Cache reads validate schema/fingerprint and structured answers against the current questions/model. Invalid judgments trigger fresh inference; malformed JSON and filesystem failures fail explicitly. Only whitelisted answer fields are stored, not source text, request bodies, transport metadata or credentials. Failed searches may retain individually successful validated judgments for resumption.
- Current source checks and post-reranking publication checks still run on cache hits. Missing/invalid entries alone require inference. `--rerank --explain` includes `judgments: { reused, new }` in the report; ordinary vector search does not expose reranking counts. Cache hits still require configured Jev credentials in this implementation, but do not call Jev. Cloudflare query embedding and retrieval remain live and billable.

### Real-service evidence

The product search service was run twice against the retained text publication with the query `restore access after verifying identity`, `--rerank --explain`, pinned Jev `jev-1.13.0`, and real Workers AI/Vectorize. A temporary observer counted calls to `JevService.evaluate` for relevance questions while delegating unchanged to the real implementation; no mock responses were used.

| Run | Reused judgments | New judgments | Observed reranking inference calls |
| --- | ---: | ---: | ---: |
| Initial cache population | 0 | 4 | 4 |
| Unchanged repeat | 4 | 0 | **0** |

Both searches reused intent; all four judgment fingerprints and relevance scores were identical on repeat. A subsequent separate product CLI process also reported `judgments: { reused: 4, new: 0 }`, confirming persisted rather than in-memory reuse:

```bash
CLOUDFLARE_VECTORIZE_INDEX=jev-checkpoint npm run --silent cli -- search 'restore access after verifying identity' --root tests/fixtures/text --rerank --explain --json
```

Credential-free validation: **39 tests passed**, plus typecheck, build, lint and formatting checks. Coverage includes query/content/model/rubric invalidation, explicit question-set-version fingerprinting, mixed hits/misses, invalid cached answers, malformed JSON, source currency, bounded concurrency, provider failures, and explain-only counts. Semantic fixture contents and publication vectors were not changed.

## Local benchmark scaffolding — credential-free only

The scale-corpus generator creates deterministic code, text, or mixed workloads. Generated blocks follow the current inventory chunking boundaries, including partial final files; regression tests compare requested counts with actual inventory results across all three kinds. Use a fresh output directory for each configuration. Nonempty destinations must exactly match the requested filenames and contents; identical repeats do not rewrite files. Changed configurations, edited files, unrelated entries, and destination/file symlinks are rejected without overwriting content. New files use exclusive creation. Failed or interrupted generation can leave a partial corpus; use a fresh directory rather than automatically deleting it. This is not transactional publication or protection against concurrent directory replacement; do not generate concurrently into the same destination. These repetitive synthetic corpora test mechanics, not semantic discrimination or realistic workload diversity.

Timing-report aggregation reports per-stage sample counts and nearest-rank p50/p95 values. It rejects malformed timing arrays, blank stage names, and negative/nonfinite durations through the typed error channel rather than silently dropping samples. Unrelated reports and empty timing arrays do not count as measurements; files with no measurements fail explicitly. Zero-duration samples remain valid. This tooling alone is not larger-project performance evidence; no live scale run or tokenizer-backed input-bound validation is claimed.

## Offline BGE tokenizer validation — implemented; hosted parity unverified

`src/publication/input` bundles the pinned upstream BERT WordPiece artifacts and `@huggingface/tokenizers@0.2.0`. Adapter preflight now validates full token counts including special tokens, rejects inputs above 512 tokens and inputs reduced to no text tokens, and rejects models without a pinned tokenizer. It performs no downloads or paid calls. The existing 500-byte input guard remains unchanged; this does not yet admit larger projections. Embedding text, pooling, cache identities, and publication generations are unchanged.

Credential-free evidence: **50 tests passed**, plus typecheck, build, lint, formatting and a network-blocked compiled tokenizer smoke check. Fourteen exact token-ID cases agree with the pinned Rust reference tokenizer; boundary tests retain full 511/512/513/1024-token sequences without truncation. Artifact checksum tests protect upstream JSON bytes, and build output includes the local assets and license attribution. This establishes local behavior, not Cloudflare tokenizer parity or hosted overflow guarantees.

## Projection collision diagnostics — implemented

`inspect validation --root <path> --json` now includes `projections`: current-record count, unique embedding-document count, number of records participating in collisions, and deterministically ordered collision groups. Each group exposes a document hash and chunk IDs/source URIs/ranges, not the embedding body. Grouping uses exact stored embedding-document equality; differing paths or text can make documents unique without establishing semantic discrimination. `complete` continues to mean artifact completeness, not quality, and collisions emit a warning rather than changing that contract. Stale records are excluded.

A read-only product inspection of the retained real-service text fixture reported **4 current records, 1 unique embedding document, and 4 colliding records in 1 group**. This reproduces the known projection problem without new inference, publication, or source changes. It is diagnostic evidence, not a relevance pass.

Credential-free validation: **52 tests passed**, plus typecheck, build, lint and formatting. Tests cover exact versus near-identical documents, deterministic source-linked groups, no projection-body disclosure, CLI JSON, and stale-record exclusion.

## Projection v2 content preview — credential-free correction, live republication pending

The embedding projection now includes the chunk line range and bounded persisted `textPreview` in addition to resource URI, media type, resource kind and taxonomy scores. `PROJECTION_VERSION` is bumped to `semantic-projection-v2`, so cached records can be projection-repaired without fresh classification and existing publication generations become stale until republished. This deliberately trades the previous taxonomy-only projection for a source-preview-aware projection because the text fixture demonstrated that empty promoted taxonomy labels produced identical embedding inputs across distinct chunks.

Projection assembly is deterministic and capped at the existing conservative 500 UTF-8 byte publication limit, truncating projection fields before provider submission rather than relying on hosted truncation. The preview is already present in local semantic records and remains bounded; full chunk text is still not written to vector metadata. This is not a taxonomy-quality fix, calibrated retrieval improvement, or privacy guarantee for sensitive sources: publication vectors are derived from the preview text, and operators should treat embedding inputs as source-derived local/remote data. Tokenizer preflight still applies after the byte cap.

A credential-free `repair-projections --root <path>` command rewrites current complete records to the current deterministic projection without acquiring Jev credentials or reclassifying chunks. It takes the onboarding writer lock and refuses incomplete/stale stores. This is intended for projection-only upgrades such as v2; it does not govern taxonomy, embed, publish or delete vectors.

Credential-free validation extends the controlled onboarding/projection checks: the text fixture now produces a unique projection document for every current record under v2 while preserving cache reuse and projection-only repair behavior, and all controlled projections stay within 500 bytes. The retained fixture caches were repaired locally without credentials: code repaired 1 record, text repaired 4, and mixed repaired 3. A read-only validation inspection of the repaired text fixture reports 4 current records, 4 unique projection documents and 0 collision groups.

### Projection v2 live publication and benchmark observation

Using Wrangler-authorized `jev-checkpoint`, all three repaired fixture scopes were republished with v2 projections. Real Workers AI embeddings and Vectorize mutations completed, and credential-free status reported every current vector query-visible. Superseded v1/v0 generations remain retained as stale vectors; no deletion was performed.

| Scope | Expected | Query-visible | Stale retained |
| --- | ---: | ---: | ---: |
| Code | 1 | 1 | 3 |
| Text | 4 | 4 | 12 |
| Mixed | 3 | 3 | 9 |

The source-pinned relevance runner was then run live against the v2 publications. Vector-only and reranked `answer-if-any` both retrieved all positive evidence at rank 1 on this tiny suite, but still answered every negative because the policy answers whenever any candidate is returned. The runner-only `rerank-min-relevance` policy at threshold 0.8 reused the freshly cached reranking judgments and abstained on all six no-answer cases while answering all six positives.

| Mode/policy | Complete | Hit@8 | Mean recall@8 | MRR@8 | Negative false-answer rate | Positive abstention rate |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Vector, answer-if-any | yes | 1.00 | 1.00 | 1.00 | 1.00 | 0.00 |
| Rerank, answer-if-any | yes | 1.00 | 1.00 | 1.00 | 1.00 | 0.00 |
| Rerank, min relevance 0.8 | yes | 1.00 | 1.00 | 1.00 | 0.00 | 0.00 |

Observed top reranked relevance scores under the threshold run: positives ranged from 0.865 to 1.0; negatives ranged from 0.22 to 0.6. This is a small-fixture development observation, not a calibrated production threshold or general relevance pass. The one-record code corpus still cannot test vector discrimination, the threshold was tried on a non-held-out suite, and taxonomy quality remains open. Full benchmark reports were kept in `/tmp/jev-v2-*-benchmark.json` and contain source previews/query-derived content.

## Retrieval-quality evaluator — credential-free scaffolding

`src/benchmark/relevance/index.ts` exports `evaluateRelevance(cases, k)` as a typed Effect. The credential-free `evaluate-relevance` CLI now reads one JSON case array and prints its metrics without provider calls or file writes. Each case supplies a unique ID, exhaustive `relevantIds` for a fixed corpus, ranked `retrievedIds`, and an explicit `answered` policy decision. Empty relevant IDs mean the corpus contains no answer. Retrieved IDs not labeled relevant count as distractors. Labels must be independently reviewed against the exact evaluated corpus; this evaluator cannot verify their correctness or detect omitted test cases.

Positive cases report hit rate, mean recall and mean reciprocal rank at k. Negative cases separately report false-answer rate, and positive cases report abstention rate. Missing cohorts produce null metrics, not perfect scores. Shortlist ranking and answer decisions remain separate: a nonempty shortlist can correctly abstain. An answer with no retrieved candidate is rejected. Duplicate cases/chunk IDs, malformed data and invalid cutoffs fail explicitly rather than biasing aggregates. These are binary-label metrics, not graded relevance, answer correctness, calibrated confidence, or a pass/fail quality gate.

Credential-free validation: **55 tests passed**, plus typecheck, build, lint and formatting. New controlled tests exercise distractor-first rankings, omitted relevant candidates, cutoff effects, multiple relevant chunks, correct/incorrect negative-query decisions, absent cohorts, input immutability and invalid data. No live benchmark corpus was labeled or evaluated, no abstention threshold was selected, and no semantic fixture or publication was changed. The next policy experiment can supply its decisions to this evaluator; production search still has no no-answer policy.

### File-based evaluator CLI

```bash
npm run --silent cli -- evaluate-relevance /path/to/cases.json --top-k 8 --json
```

The file must contain a nonempty array, for example (illustrative IDs only, not live evidence):

```json
[
  {
    "id": "recovery-positive",
    "relevantIds": ["recovery-guide-chunk"],
    "retrievedIds": ["session-distractor-chunk", "recovery-guide-chunk"],
    "answered": true
  },
  {
    "id": "expiry-negative",
    "relevantIds": [],
    "retrievedIds": ["session-distractor-chunk"],
    "answered": false
  }
]
```

Use actual chunk IDs from the fixed corpus for real evaluations. `--top-k` is required and applies to ranking metrics only; `answered` records the supplied policy's decision and is not recomputed at that cutoff. Missing or invalid files/labels/options exit nonzero with diagnostics on stderr and no partial JSON stdout. Successful computation exits zero even for poor metrics; no acceptance thresholds are implied. Plain output explicitly states that metrics are not a semantic quality pass. The command does not run searches, infer labels, or authenticate to providers.

Credential-free validation after CLI integration: **58 tests passed**, plus typecheck, build, lint and formatting. Subprocess tests cover JSON and text output, empty credentials and unavailable external commands, input preservation, distractor cutoff effects, false answers, malformed/missing files, missing decisions and invalid arguments. No live quality evaluation or production abstention policy is claimed.

## Source-pinned relevance cases — prepared, not live evidence

`tests/support/relevance-cases.json` supplies six positive and six no-answer queries across the unchanged code/text/mixed fixtures, with exhaustive relevant-chunk labels and source-based rationales. Cases distinguish deletion from expiry checks, recovery instructions from verification details, retry delay calculation from operator-notification implementation, and general retry evidence from implementation-specific requests. These are source-reviewed development labels, not independently human-adjudicated or held-out calibration data.

A credential-free regression test pins every inventoried file hash and chunk boundary (including trailing blank lines), rejects unresolved/duplicate label references, and requires positive/negative coverage. Relative path/range labels avoid committing machine-specific chunk IDs. [The benchmark guide](relevance-benchmark.md) documents resolving labels to current IDs, collecting comparable vector/reranked observations, explicit hypothetical answer policies, and incomplete-run handling. The dataset is not directly an evaluator observation file: queries/labels still need actual results and explicit policy decisions.

Validation: **59 tests passed**, plus typecheck, build, lint and formatting. No provider calls, live benchmark scores, fixture modifications, projection changes or production abstention behavior are claimed. The observation runner is implemented in the following checkpoint; its live comparison remains pending. A passing dataset consistency test is not a retrieval quality pass.

## Source-pinned relevance runner — implemented; v2 live small-fixture observation recorded

`benchmark-relevance <suite.json> --root <corpora-parent> --top-k <n> --policy answer-if-any|rerank-min-relevance --run-paid [--rerank --min-relevance <0..1>] [--json]` invokes the existing product search service for each suite query. Paid work requires explicit acknowledgement. All corpora are validated against the suite before searching; symbolic labels resolve to current inventory chunk IDs. Search is sequential, explain-enabled and semantic-only, with no lexical fallback. The normal search service retains its own provider, source and publication checks.

The report retains per-case full search observations or structured failures, a normalized-suite hash, mode/cutoff, and timestamps. Foreign/duplicate chunks, wrong query/mode and within-corpus publication-generation changes invalidate observations. Every corpus receives a final source check. Any observation/currency failure marks the run incomplete, suppresses aggregate metrics and exits nonzero; provider failures are never silently dropped or counted as correct abstentions. Preflight failures and cancellation do not produce partial report files. Successful query caches may remain after interruption, as with ordinary search.

The default answer policy is explicitly a **hypothetical answer-if-any baseline**, based on nonempty retrieval rather than labels or judgment confidence. A second experimental runner-only policy, `rerank-min-relevance`, requires `--rerank --min-relevance <0..1>` and answers only when the top Jev-reranked candidate meets that explicit score. This still does not implement production abstention or calibrate a threshold. Complete collection is not a relevance pass. Full reports contain source previews/query-derived content; keep them in local sensitive storage, outside the source corpus. [The guide](relevance-benchmark.md) documents paid commands, comparison requirements and limitations.

Credential-free validation: **68 tests passed**, plus typecheck, build, lint and formatting. Controlled tests cover all 12 observations in both modes, threshold-policy no-answer decisions despite retrieved candidates, missing reranking judgments, failure retention, invalid generations/chunks/results, preflight-before-search, final source failures, unsafe/malformed suites, cutoff bounds, cancellation and paid-CLI acknowledgement. An earlier full-suite attempt exposed the existing timing-sensitive reranking concurrency assertion (observed two simultaneous calls instead of the asserted three); subsequent full-suite runs passed without changing it. The v2 live benchmark observation is recorded in the projection-v2 checkpoint above; it is small-fixture development evidence, not a production quality gate.

**Next work:** do not promote the observed 0.8 runner threshold into production without held-out calibration and a designed answer contract. Taxonomy quality remains open even though preview-aware projections improved fixture discrimination. Caching reduces cost and latency; it does not repair taxonomy quality or calibrate confidence. Hosted validation of tokenizer-backed input bounds remains required before larger-project validation. [Primary-source investigation](research/bge-tokenizer-input-bounds.md) records the upstream BERT WordPiece artifact revision/checksums, the 512-token budget including two special tokens, and a staged offline-validation plan. Cloudflare's deployed tokenizer revision and overflow behavior remain unverified; the 500-byte guard is unchanged. The semantic retrieval quality gate remains open for larger/held-out validation.
