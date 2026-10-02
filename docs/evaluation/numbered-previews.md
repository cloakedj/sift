# Numbered preview validation

Status: implemented presentation change, validated with local regressions and
replay of two saved real-service development reports. Not a held-out comparison,
independent grading result, new-chunker validation, or measured cost improvement.

## Change

Agent output is schema 2: `preview` has original source line prefixes;
`previewRange` distinguishes the displayed prefix from full chunk ranges;
`previewTruncated` and `previewClippedMidLine` describe presentation clipping.
The cap remains 1200 source UTF-16 code units before numbering, with no split
surrogate or CRLF pairs. Full non-agent reports, retrieval policy and chunk IDs
are unchanged. See [format semantics](../structured-retrieval.md#agent-facing-output).

## Real-service development observations

Before editing source, `status --root . --json` succeeded against 2,088 chunks.
Both searches used the repository root and existing `sift.config.json`, with
`--rerank --top-k 5 --explain --json`. Full reports were deliberately retained
instead of losing provenance/timings in compact output; the existing agent
projector generated each before snapshot without another provider call.

1. `Where is the lexical index saved on disk?` returned insufficient evidence:
   zero accepted results, eight diagnostic candidates, 14 new judgment visits.
2. The named remaining gap was the exact storage path/filename. A focused query,
   `What filename and directory does LexicalService.build use to persist the lexical index?`,
   with `--anchor 'INDEX_FILE'` (a symbol present in the first report), returned
   one accepted result with the constant as supporting reference context.
   Judgment visits: eight reused, sixteen new. Visits are not unique calls/tokens.

These are hybrid/anchor-assisted runs, **not semantic-only successes**. The second
query was a follow-up, not a paired A/B trial. No broad grep or scope change was
used to answer the lookup. Tests were inspected as implementation regressions,
not added to the retrieval corpus.

Publication fingerprint:
`b4e3eaa476e4d6666740f4606a9e5e2c78dbde2609974defca90678e929473b3`.

Full-report SHA-256:

- Broad lookup: `03d4b01db125cb5d6e809c774cd0b32601fcac6e7417f75ba5c27270988c35a5`
- Focused lookup: `89b5fd42ce45ffb8259498d38e5d653ba54c7cbba1a4b51e445dc275e73716a7`

Private temporary artifacts: `/tmp/sift-numbered-previews-f3j4tP/`. This is not
permanent storage. It contains full reports, before/after agent projections,
configuration/skill snapshots, source revision and tracked diff/status, pinned
cited-source bytes, a replay validator and its measurement summary. Original
historical cases and independent reviews remain missing. Pi session accounting
and raw provider usage/cost are not exported; costs remain **unknown**, not zero.

## Fixed-evidence validation

The new projector replayed exactly the same full reports, with no new inference.
All **19 excerpt occurrences** (eight broad, eleven focused) matched the saved
source hashes and source byte slices. Displayed line numbers matched original
source lines. Acceptance, candidate order, relevance/primary relevance, context
relationships, evidence status, budgets, truncation and warnings were unchanged.
Source reads in the validator checked implementation correctness; they are not
claimed as avoided agent tool calls.

The focused preview directly supports `<inventory.root>/.sift/lexical-index.json`:
`src/lexical/index.ts:31–33` supplies directory/write behavior and
`src/lexical/consts.ts:2` supplies the literal filename. The discovery-completeness
prerequisite is visible at `src/lexical/index.ts:17–22`. No further search or source
read is needed for this fixed-evidence answer. This is a worked development check,
not an independently scored synthesis experiment.

### Duplication and size

| Report portion | Excerpt occurrences | Unique chunks | Duplicate occurrences |
| --- | --- | --- | --- |
| Broad diagnostic candidates | 8 | 8 | 0 |
| Focused accepted result + context | 2 | 2 | 0 |
| Focused diagnostic candidates + context | 9 | 8 | 1 |
| Focused accepted + diagnostic output together | 11 | 8 | 3 |

The focused diagnostic duplicate is the constant appearing as a primary candidate
and as reference context. Counting accepted plus diagnostic output adds repeated
result/context serialization. Focused output contains 6,122 cumulative displayed
source UTF-16 units versus 5,050 unique units. These are characters, not tokens.

Compact JSON bytes increased from 7,507 to 8,816 (broad) and 10,955 to 12,952
(focused), including line prefixes and range metadata. No cost reduction is
claimed. Keep serialization unchanged for now: the accepted-only example has no
duplication, and two cases do not justify a source-table/reference format change.
Do not suppress seen chunks or conflate a rejected primary with accepted context.

Original retrieval end-to-end timings were approximately 32.43 s and 9.91 s;
these different queries/cache states are not a latency comparison. Replay is
local presentation work, not a new end-to-end retrieval measurement.

## Local validation and remaining work

All 112 credential-free tests passed, including nine agent-output tests. Checks
cover LF/CRLF, trailing/blank/empty lines, Unicode byte offsets, surrogate and
CRLF clipping, exact-budget previews, actual syntax/document chunk slices,
mid-line continuation chunks, and repeated evidence with separate judgments.
Typecheck, build, lint, formatting and diff checks passed. Fixture contents were
not changed.

Current-repository source edits make the old publication stale under the existing
currency contract. Re-onboard/publish before the next live search; no new live
publication is claimed for these presentation edits. Next: investigate chunk
boundaries against saved evidence and local inventories before changing identities.
