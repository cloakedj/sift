# Small-fixture relevance benchmark

`tests/support/relevance-cases.json` records 12 source-reviewed queries: six positive and six no-answer cases across the existing code, text and mixed fixtures. Labels were assigned from the fixture source, not from model scores. These are proposed evaluation judgments, not independent human adjudication or live retrieval evidence.

## Label contract

- Each corpus pins every inventoried file by SHA-256 and names every chunk by relative path and inclusive line range. Symbolic chunk keys are local to that corpus. Production chunk IDs depend on the absolute root and must be resolved from a fresh inventory rather than committed here.
- Each case lists all chunks in that corpus that directly support its query. An empty `relevant` list means the supplied corpus cannot answer it. Related headings, imagined surrounding code, and instructions that merely mention an unimplemented function are not directly supportive.
- Each label has a source-based rationale. In particular, session deletion is not expiry validation, mentioning identity verification does not specify a verification method, and prose requesting operator notification is not notification implementation.
- The broad increasing-pause query deliberately has two relevant chunks. Implementation-specific and guidance-specific queries test whether those same chunks become distractors when the requested evidence differs.
- The self-service query contains a strict requirement (without an administrator). This is a benchmark judgment about answer support, not a change to production intent's soft-negative policy.

`tests/relevance-cases.test.ts` checks that source hashes, the full file set and all chunk boundaries still match; labels cannot silently survive source changes or additional unlabeled chunks. It also checks unique case/chunk keys, valid references and positive/negative coverage. Tests verify dataset consistency, not the semantic truth of judgments or model quality. Any corpus or chunker change requires reviewing labels before updating the pins.

For `structure-v4`, the unchanged handbook source was reviewed again: departure is
now the combined title/instruction at lines 1–4, and recovery the combined
heading/instruction at lines 5–7. The separate heading keys were removed. All case
questions and positive/negative decisions remain unchanged; neither title adds a
verification method or self-service procedure. Source hashes and fixture contents
are unchanged. This is a development label review, not independent adjudication;
old suite hashes/generations cannot be reused as current comparison evidence.

## Running a comparison

The product runner requires explicit acknowledgement of paid calls and an explicit answer policy:

```bash
npm run --silent cli -- benchmark-relevance tests/support/relevance-cases.json \
  --root tests/fixtures --top-k 8 --policy answer-if-any --run-paid --json \
  > /tmp/sift-vector-benchmark.json

npm run --silent cli -- benchmark-relevance tests/support/relevance-cases.json \
  --root tests/fixtures --top-k 8 --policy answer-if-any --run-paid --rerank --json \
  > /tmp/sift-reranked-benchmark.json

npm run --silent cli -- benchmark-relevance tests/support/relevance-cases.json \
  --root tests/fixtures --top-k 8 --policy rerank-min-relevance --rerank \
  --min-relevance 0.8 --run-paid --json \
  > /tmp/sift-reranked-threshold-benchmark.json
```

Configure the same Jev model and Cloudflare account/index used by the fixture publications before running. The runner never onboards, publishes, or deletes vectors. It performs live searches, which may populate intent/reranking caches and incur provider usage. Keep output outside the corpus. Full explain reports contain query text, source previews, paths, classifications and provenance; treat them as sensitive local artifacts.

The runner preflights all file hashes and chunk locations before the first search, resolves actual chunk IDs, and processes each case sequentially. It preserves search reports or structured failures for every attempted case, rejects foreign/duplicate chunks and changes of publication generation within a corpus, and checks every corpus again after the run. Any case or final currency failure yields `complete: false`, `metrics: null`, and exit status 1. Preflight errors produce stderr diagnostics without an observation report. Cancellation stops the run rather than converting interrupted work into abstentions; intermediate outcomes are currently held in memory, so interrupted runs have no persisted partial report. Currency checks are bounded observations, not source locks or continuous publication verification.

Reports include a normalized-suite hash, timestamps, cutoff/mode, and a policy kind. The baseline, `answer-if-any`, sets `answered` from whether any candidate was returned and reports `policyKind: "hypothetical-baseline"`. The experimental `rerank-min-relevance` policy requires `--rerank --min-relevance <0..1>` and answers only when the top reranked candidate's Jev relevance score meets that explicit threshold; it reports `policyKind: "explicit-threshold-experiment"`. Neither policy changes production search. Threshold values are experimental inputs, not calibrated confidence. An empty successful retrieval is an abstention for these benchmark policies only. `complete: true` means all observations were collected consistently, **not** that their metrics pass a quality gate. The command has credential-free controlled tests but has not yet been exercised as a live semantic checkpoint.

For a manual comparison or a different explicitly documented policy:

1. Run the test suite and confirm complete, current publication for each fixture scope.
2. For every case, run its exact query against its scope with the product `search --explain --json`, then repeat with `--rerank`. Record the command, date, pinned model, publication generation, query intent, returned chunk IDs and scores. Retrieval and uncached judgments incur provider usage.
3. Resolve each symbolic relevant key through its pinned path/range to the current inventory chunk ID. Convert each observation to the evaluator shape: `{ id, relevantIds, retrievedIds, answered }`. Use the returned order, not a re-sorted or deduplicated substitute. Keep vector-only and reranked observations in separate files.
4. Supply `answered` from the explicitly documented policy under test. Do **not** derive it from the relevance labels, and do not treat Jev judgment confidence as calibrated answer confidence. Current product search returns candidates and implements no answer/abstention decision; ranking observations alone do not establish a production no-answer rate. If testing a baseline such as “answer whenever a candidate is returned,” label it as that hypothetical baseline, not as implemented behavior.
5. Evaluate each observation file with `evaluate-relevance <file> --top-k <n> --json`. Preserve raw observations separately; evaluator metrics alone omit provider/source provenance. Use the same cutoff and case set when comparing variants. Record every failed case separately rather than silently dropping it or converting a provider failure into an abstention.

The standalone `evaluate-relevance` evaluator does not enforce suite completeness or provenance. The runner does enforce case coverage and source pins, but its full report is not an evaluator case-array input. For manual files, verify all 12 case IDs occur once and retain failures visibly. When comparing separate vector/reranked runs, also check that suite hashes, cutoffs, case sets, per-scope publication generations and pinned models agree; the runner does not compare two reports automatically. Do not aggregate an incomplete run into a claimed pass.

## Limitations

This suite is tiny and deliberately includes previously observed failure modes. It is a regression/development set, not a held-out calibration set. The one-record code corpus cannot test ranking discrimination. Text and mixed corpora provide only a few distractors, and their entire populations fit within the current reranking limit. Passing would not establish recall on larger corpora, tokenizer parity, a calibrated threshold, or general search confidence. No fixture sources, projections, governance thresholds or production answer policies are changed by adding these labels.
