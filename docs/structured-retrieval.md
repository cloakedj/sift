# Structured retrieval

## Source boundaries and identity

The `structure-v3` chunker shares a source-neutral unit/relationship contract across
code and prose. Source structure is distinct from Jev classifications/relevance
judgments and from the indexes used to discover candidates. These are logical
boundaries, not separate databases or a persisted summary tree.

The code extractor uses a pinned TypeScript compiler API (runtime dependency
`typescript-ast`, separately from the build compiler). Build/typecheck scripts explicitly
invoke the build compiler because the aliased package also ships a `tsc` binary.
It parses JS/JSX/TS/TSX and
module variants without reading dependencies from disk or executing source.

Top-level functions, arrow/function-valued variable declarations, other declarations,
and class members have separate retrieval boundaries. Imports are grouped. Nested
callbacks stay with their enclosing declaration; object literals and namespaces are
not recursively decomposed in this version. Named nested declarations are not yet
independent source units. Unsupported languages, invalid syntax, files larger
than 1 MiB, and declaration-free code retain bounded streaming windows. The record's
`resource.structure.mode` distinguishes `syntax`, `document`, and `bounded` extraction.

For Markdown, ATX headings define nested sections; paragraphs and fenced blocks are
child units. Fences are opaque to heading/paragraph detection. Plain `.txt` and `.rst`
use paragraphs without guessing heading syntax. This is not a complete Markdown/RST
parser: Setext headings, document-link resolution, and semantic cross-document
associations are not extracted. Explicit document-link provenance is reserved in
the relationship contract, not claimed as a current extractor capability.

The 8192-byte and 48-line limits remain safety caps. Oversized declarations and
paragraphs split into ordered pieces while preserving their owning unit's identity.
A class owns header/footer pieces; a section owns its heading. Both can contain
child units without copying their full bodies into every chunk.

Structured chunks store:

- `unit`: owning unit ID, parent ID, resource ID/hash, full byte/line range,
  content hash, source kind, and optional label;
- `ancestors`: enclosing source units;
- `part`: zero-based index and count among directly owned chunks;
- `related`: typed pointers with source basis, not inferred relevance.

Relationships are `container`, `contains`, `continuation`, `adjacent`, and `reference`.
Continuation links connect immediate pieces; adjacency connects neighboring units
under the same parent. Bounded fallback chunks link to immediate neighboring windows.
Structural links use `source-structure` basis; code references distinguish
`bound-symbol` from `indexed-import`. None implies runtime call-graph completeness.

Top-level units belong to the file's resource ID. Methods belong to classes and
paragraphs to sections. Parent identity is explicit, not inferred from equal names.
Directly owned parts do not include chunks owned by descendants.
`reassembleUnit` validates the full file hash and unit range/hash, then slices the
original bytes. It therefore includes descendants, comments, and whitespace without
duplicating overlap or mixing file versions. Reassembly is an explicit utility;
retrieval does not automatically load unlimited parent bodies.

Bound-symbol references avoid links from shadowed identifier spellings. Explicit
relative named imports are linked only when the destination is indexed and
unambiguous. Package imports, re-exports, default/namespace imports, dynamic calls,
and ambiguous declarations are not guessed. This is not a complete call graph.

## Embedding and presentation

`semantic-projection-v4` spends the conservative 500-byte embedding budget on the
source label (symbol or enclosing heading) and source text instead of absolute paths and bookkeeping. Long source uses
head/tail excerpts; it is still lossy and is not a generated semantic summary.
Strong taxonomy labels may fill remaining space. Full bounded source is retained
for presentation and reranking, not only its first 240 characters.

Query embeddings keep the raw question, inferred intent/answer shape, and positive
terms. Taxonomy judgments remain available to the reranker but are no longer all
injected into the embedding merely because their probability is nonzero.

## Shared hybrid discovery and anchors

Search defaults to hybrid discovery over the active, source-current publication.
The existing lexical token/phrase/path scorer operates on published source text;
there is no second persistent index and no live-corpus substitution on provider failure.
Lexical tokenization includes Unicode letters/numbers.

Vector and lexical candidates are deduplicated by chunk ID and merged using reciprocal
ranks, never summed raw scores. Each candidate retains its `discovery` signals.
`score` is a reciprocal-rank score in hybrid mode; raw lookup scores remain in those
signals. A lexical origin does not imply weak evidence; a vector origin does not
establish relevance.

Repeatable `--anchor <literal>` adds case-sensitive exact clues. The service also
accepts `{kind: "location", uri, line?}` anchors, using exact source URIs and one-based
lines. At most eight anchors of 2048 bytes each are accepted. Matching anchors get
shortlist priority but do not exclude other candidates or bypass assessment.
`coverage.anchorMatches` exposes zero/multiple matches rather than asserting a unique
resolution. `--semantic-only` disables lexical discovery and cannot be combined with
anchors; it retains the vector-only baseline. The former `--lexical-fallback` flag
has been replaced by shared hybrid discovery.

```sh
npm run cli -- search 'Which error marks expired refunds?' --root <corpus> --anchor ERR_REFUND_WINDOW --rerank --explain --json
npm run cli -- search 'Which error marks expired refunds?' --root <corpus> --semantic-only --rerank --json
```

Without reranking, hybrid retrieval returns unassessed candidates. With `--rerank`,
all shortlisted candidates use the same Jev assessment, context expansion and
threshold policy—even when there are no vector hits. Candidate discovery still
requires a valid publication and the existing cloud/intent path; this is not an
offline mode or automatic provider-failure fallback.

## Agent-facing output

For routine harness retrieval, use compact presentation without changing ranking,
thresholds, or provider work:

```sh
npm run --silent cli -- search 'How does onboarding persist failures?' --root src/onboarding --rerank --top-k 5 --agent --json
```

`--agent` requires `--json` and cannot be combined with `--show-intent`. It returns
paths, inclusive source line ranges, symbols, relevance scores when assessed, and
previews capped at 1200 UTF-16 code units per primary/supporting chunk. A
`previewTruncated` flag explicitly marks clipped previews; source ranges still
refer to the full chunk. Consumers should read those ranges for verification.
Taxonomy, full provenance, publication backend details, and timings are omitted.
Evidence status, bounded coverage, candidate/result truncation, budgets, findings,
and supporting-context relationships remain visible.

`--agent --explain --json` additionally exposes compact diagnostic candidates and
judgment counts. Candidates are separate from accepted results. Explain does not
increase the discovery budget; use a focused follow-up query for a missing angle.
Omit `--agent` for the unchanged full diagnostic report, including intent and
publication provenance. Agent reports are presentation output, not benchmark
provenance artifacts or calibrated answer-confidence reports.

The [`sift` skill](../.agents/skills/sift/SKILL.md) checks [configured corpus boundaries](configuration.md), starts with this format, and verifies returned ranges before
searching again. Follow-ups target distinct unresolved facts rather than obeying a
fixed count. Repeated follow-ups without resolving a gap trigger explain diagnosis
once for the relevant query. Searches stop when results repeat or stop adding useful
evidence; remaining gaps are disclosed, with lexical fallback or deeper investigation
offered to the user. Explicit user budgets still apply. Adjacent ranges should be
combined into one source read; individual ranked chunks remain distinct in the output
to preserve their scores and acceptance semantics. These are cost-control policies,
not measured quality guarantees.

## Bounded evidence expansion

With `--rerank`, the merged shortlist contains up to eight primary candidates before
applying `--top-k` to returned results. Without reranking, hybrid discovery uses a
shortlist of `max(8, topK)`; semantic-only discovery retains the requested vector limit.

1. Judge primary chunks against the raw query and structured intent.
2. Explore one hop from at most two seeds with relevance at least 0.45.
3. Consider up to eight distinct related chunks from the same validated publication.
   References and structural links guide exploration; structured prose does not
   receive arbitrary nearest-same-file neighbors across section boundaries.
4. Judge these independently. Select at most two context chunks per seed, each with
   relevance at least 0.5 and a combined budget of 16 KiB per seed.
5. Judge the primary together with this explicit context. Prefer directly supported
   primary evidence over callers that only become sufficient through context.
6. Recheck publication/source currency before returning.

These bounds are exploration policies, not calibrated probabilities. Expansion does
not recurse. Every supporting source is hash-checked before judgment, and only
records from the active publication can become context. Pointers grant eligibility,
not relevance or cache validity. Independent context judgment can still miss a
bridge chunk that is useful only jointly with its seed; pair-aware assessment is
not implemented or claimed validated here. A new query can require up to 18 distinct judgments
(eight primary, eight context, two combined); cached evaluations may be revisited.
The explanation's reused/new judgment counts count evaluation visits, not unique chunks.

`context` is separate from the primary result and includes the relationship and exact
source location and relationship basis. `primaryRelevance` preserves the standalone judgment when the
reported `relevance` assesses combined evidence. `--explain` retains rejected primary
candidates for inspection.

## Insufficient evidence

Reranked search defaults to `--min-relevance 0.75`. Candidates below this policy are
withheld from `results`; if none qualify, the CLI explicitly reports insufficient
evidence. This does **not** prove the feature is absent from the corpus, nor is 0.75
an empirically calibrated confidence threshold. Use `--min-relevance 0` with
`--rerank` for diagnostic unfiltered retrieval. Non-reranked results are
`not-assessed`, not affirmative answers. Reranked empty discovery is `insufficient`.

Results separately expose:

- `execution: complete`: the bounded operation finished, not an exhaustive answer.
- `coverage`: active-publication scope, `exhaustive: false`, discovered/assessed
  primary counts, unstructured chunk count, and bounded-discovery/expansion limits.
- `truncation`: known candidates omitted before assessment versus eligible results
  omitted by `topK`. It does not count unknown matches beyond the vector shortlist.
- `budget`: primary/context candidate, seed, per-seed chunk and byte caps.

The consumer owns final task reasoning. Relevance scores do not prove correctness,
absence, or completeness. Source hashes and full request fingerprints continue to
protect judgment reuse; retrieval links are not an invalidation dependency graph.

The relevance benchmark deliberately requests semantic-only, unfiltered retrieval
and applies its own answer policy, preserving the existing baseline. Mixed retrieval
regressions do not establish a measured improvement over that baseline.

## Migration

Old chunk identities/publications are not current under the new chunker. Re-onboard
and republish each corpus; projection-only repair is not a substitute for rechunking:

```sh
npm run cli -- onboard src/lexical
CLOUDFLARE_VECTORIZE_INDEX=jev-checkpoint npm run cli -- publish --root src/lexical
```

This incurs real classification/embedding work. Old generations remain inactive;
this change does not delete unrelated remote vectors.

## Current direct checks: mixed sources and Jev

Before adding regression tests, the product CLI inventoried a temporary mixed corpus
containing a Markdown policy, TypeScript refund helper, and long Unicode plain text:
3 resources, 17 chunks. Direct assertions checked exact UTF-8/CRLF ranges, source-unit
reassembly and stale-source rejection, paragraph continuations, nested headings,
opaque fences, reference basis, mixed lexical/vector candidate merging, literal and
location anchors, Unicode lookup, and section-local context exploration.

A separate real `jev-1.13.0` reranking call assessed two lexical-origin source
candidates for “Which error code is used for expired refund requests?”:

| Source | Observed relevance |
| --- | --- |
| `Use ERR_REFUND_WINDOW for expired requests.` under Refunds | 1.0 |
| `Payments accept cards only.` under Payment methods | 0.055 |

These were two new provider judgments, not mocked or cached responses. The request
used a manually constructed intent to isolate the assessment path. No new real
Cloudflare publication/query or end-to-end intent run was performed for this change.
This is narrow live assessment evidence, not an accuracy benchmark. Temporary raw
probe assets/results were kept under `/tmp/jev-general-context-*`; durable regressions
now cover the deterministic behavior separately, including stubbed retrieval wiring.

## Historical real-service check: src/lexical (syntax-v2)

The following results predate `structure-v3` and hybrid discovery; they are not a
validation of the current generalization.

On 2026-09-29 the existing corpus was re-onboarded into 18 chunks and published to
`jev-checkpoint`. All 18 vectors were verified visible. The first publication attempt
failed with a Cloudflare request error; retry succeeded. Publication fingerprint:

`9072745a9da156e06aaf5bcb329e013baae2d8ed5cd0399a8cc047dd24b5d623`

Each query used `search --root src/lexical --rerank --top-k 3 --explain --json` against
real Cloudflare and Jev services (some final judgments reused caches from earlier
runs of this investigation). These are not mock-only semantic claims.

| Query | Observed result |
| --- | --- |
| how are chunks scored | `scoreChunk`, utils.ts:11–24, first; actual scoring code visible |
| what is the total results that can be returned if I run a query | `LexicalService.recover` and `LexicalService.search`, both with `MAX_HITS` reference context |
| How are duplicate words and single-character tokens handled? | `tokenize`, utils.ts:3–10, first |
| Does an exact phrase match receive a scoring bonus? | `scoreChunk` first; caller second with explicit scoring context |
| Where is the lexical index saved on disk? | `LexicalService.build` first with `INDEX_FILE` reference context |
| What happens when the search query is empty? | `LexicalService.recover` and `LexicalService.search`, both containing the guard |
| How does lexical search correct spelling mistakes? | Insufficient evidence; zero returned results |
| How does the index encrypt stored chunks at rest? | Insufficient evidence; zero returned results |

Full local diagnostic reports: `/tmp/jev-structured-check/*-final.json` (temporary,
not repository artifacts). Selected final runs took approximately 4.1–5.6 seconds;
these mixed cache states are not a controlled latency benchmark. This small-corpus
check does not establish cross-language coverage, large-corpus recall, or a calibrated
abstention threshold. Credential-free tests separately cover parsing, parent links,
reassembly, staleness, bounds, shadowing, context selection, and abstention mechanics.
