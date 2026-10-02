# Chunk-boundary development validation

Status: `structure-v4` implemented and locally validated. No new-generation live
retrieval-quality result is claimed. Retrieval budgets, thresholds, reranking
rubrics and discovery policy are unchanged.

## Hypothesis check before editing

The repository's configured corpus was inventoried without inference or writes:

```sh
npm run --silent cli -- onboard . --dry-run --json
```

The original inventory had 2,116 chunks, including 628 document chunks from 18
resources. Of these document chunks, 172 contained only an ATX heading and
whitespace. Both `.sift/` and legacy `.jev/` remained excluded; no state stores
were used as reference evidence.

The two [saved lookup reports](numbered-previews.md) contained **zero heading-only
chunks in 16 primary assessment slots**. They therefore do not establish that
heading-only chunks caused either observed retrieval outcome. They do contain a
short command description and an isolated fenced example without nearby prose.
Historical evolution/onboarding reports remain unavailable; do not substitute
these two development lookups for those missing cases.

## Bounded structural repair

- A heading is grouped with its first direct body passage. If oversized, that
  passage splits under the existing 8,192-byte/48-line caps, with shared unit
  identity and continuation links. Pathological headings/separators can still
  produce content-poor pieces when the caps prevent reaching body text.
- Later colon-ended labels join immediately following Markdown lists if the
  combined group fits. Fences join adjacent explanatory paragraphs under the
  same caps. Larger groups remain separate and structurally linked.
- No grouping crosses a heading. Empty sections and container headings with no
  direct body are retained rather than assigned unrelated child-section text.
- Fenced heading markers and blank lines remain opaque. Full heading ancestry
  is retained in the source label, including explicit status words, without
  inferring authority. Individual ancestor units keep exact labels/ranges.
- Source is retained once as contiguous slices. Byte cutoffs preserve UTF-8 and
  CRLF boundaries. Plain-text/RST paragraphs, code extraction and large-resource
  bounded fallback behavior are not redesigned.

The shared version changed from `structure-v3` to `structure-v4`. This invalidates
all existing chunk identities, including code/fallback IDs even where boundaries
are unchanged. Classification and publication work may be incurred on refresh.

## Fixed-source comparison

All 18 document resources were copied and SHA-256 pinned **before** editing code
or documentation. The new chunker was replayed on those same bytes, not on the
subsequently modified repository. Raw artifacts, source pins, old inventory,
replayed chunks and validator are private temporary files at
`/tmp/sift-chunk-boundaries-6ZT0tL/`; this is not durable artifact storage.

| Fixed document inventory | Before (v3) | After (v4) |
| --- | ---: | ---: |
| Document chunks | 628 | 364 |
| Heading-only chunks | 172 | 16 |

The validator checks identical retained source coverage, exact UTF-8 slices and
line ranges, caps, deterministic chunk IDs, valid relationship targets, and
source-unit/ancestor reassembly for every new document chunk. The reduction is
an inventory property, **not** a measured improvement in shortlist coverage or
assessment cost. Longer chunks can increase judgment/presentation input volume;
no token or latency savings are claimed.

Replaying on the pinned source bytes from the old live reports also shows:

- `src/cli/README.md:147–148`, previously just “Run legacy lexical diagnostic
  search,” is now inside lines 145–154: heading, description, command example and
  the explicit limitation that it is not semantic search. Its label retains
  `Sift CLI > Commands > lexical-search` (with source backticks).
- `docs/semantic-search-flow.md:84–87`, previously an isolated command fence, is
  now inside lines 80–113 with its heading, command label, flow and intent example.
  This supplies surrounding text; it does not establish that this design document
  describes current implementation.

No old scores are reassigned to these new passages. Their discovery, relevance
and acceptance require fresh observations after publication.

## Regression and label review

All 117 credential-free tests passed, plus typecheck, build, lint, format and diff
checks. Coverage includes heading/body attachment, generic title ancestry,
introductory labels/lists, fenced examples and explanations, oversized sections
and fence continuations, exact Unicode/CRLF byte and line boundaries, determinism,
source reassembly, safety caps and large-resource fallback. Existing numbered
preview tests continue to check actual document and syntax chunk slices.

Fixture contents and hashes are unchanged. The development relevance suite's
handbook pins were intentionally reviewed and updated from four fragments to two
passages: departure at lines 1–4, recovery at lines 5–7. Questions and positive/
negative judgments are unchanged. This is source-based development review, not
independent grading or held-out calibration.

## Next validation gate

After all source edits in this stage, use the same repository root/configuration:

```sh
npm run cli -- onboard .
npm run cli -- publish --root .
npm run cli -- status --root . --json
```

Projection repair alone cannot migrate changed chunk IDs. Record the new
publication generation and repeat the saved development queries at the same
assessment budget. Track required-passage availability, actual fragment assessment
slots, cache state, latency and provider usage/cost where reported. Old publication
results do not validate v4. No new paid retrieval calls were made in this local
boundary experiment; earlier provider costs remain unknown.
