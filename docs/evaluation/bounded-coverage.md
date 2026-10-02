# Bounded retrieval coverage: diagnostics and opt-in experiment

Status: implemented and credential-free tested. The default retrieval policy is
unchanged. No new-generation live retrieval, required-fact coverage improvement,
independent grading result, or fully costed A/B is claimed.

## Diagnose a known missing passage first

Use the same root/configuration throughout. Obtain current chunk IDs from a dry-run
inventory or supported `inspect records`; do not read `.sift/` or `.jev/` stores as
ordinary reference evidence. Old chunk IDs do not identify new-version chunks.

After source-current onboarding and publication:

```sh
npm run --silent cli -- search '<exact frozen question>' --root . \
  --rerank --top-k 5 --explain --json --trace-chunk '<current chunk ID>' \
  > /tmp/sift-target-trace.json
```

`--trace-chunk` is repeatable for at most eight distinct SHA-256 IDs. It requires
full `--explain --json`, not `--agent` or intent-only mode. The flag changes
reporting, not search scope, selection, scoring, thresholds or assessment calls.
Keep reports private and outside the corpus: they contain query/source text and
exact application-constructed judgment requests. No raw provider response bodies,
credentials or stacks are added. Do not pass these reports to blinded graders.

Each `diagnostics.targets` entry separates:

| Pipeline question | Diagnostic fields / interpretation |
| --- | --- |
| Was it inventoried and published? | `published` and pinned `source` URI/range/hash. Presence is in the source-current active publication. Absence does not distinguish an obsolete ID from exclusion or missing source; check the inventory separately. |
| Did discovery find it? | `discovery.semanticRank`, `lexicalRank`, `anchorRank`. A missing vector rank means absent from the bounded vector response, not proof of semantic irrelevance. |
| Did it reach the shortlist? | `inPool` versus `shortlisted`: distinguish local pool truncation from final selection. |
| Was structural context available? | `context.eligibleFor` lists eligible seed links before the context-pool cutoff; `assessed`, `judgment`, `selectedFor` and `returnedFor` separate assessment, selection and actual delivery. Structural eligibility does not establish usefulness. |
| Was it rejected? | `primaryJudgment` versus `finalJudgment`, with `primaryOutcome: rejected`. Context judgments stay separate even if a rejected primary is useful as context. |
| Was accepted evidence cut off? | `primaryOutcome: omitted-by-top-k` versus `returned`; `returned` is also explicit for unassessed searches. |

Other primary outcomes are `not-in-publication`, `not-discovered`,
`outside-merge-pool`, `outside-shortlist` and `unassessed`. Context-only evidence can
have a primary discovery loss and still be delivered under `context.returnedFor`.
Provider/execution failures abort the search through the existing error pipeline;
they are not converted into insufficient evidence or partial success diagnostics.

`embedding` contains the exact stored embedding document, its hash, exact collision
group size, up to eight peer IDs, and an explicit omitted-peer count. These are
exact-input collisions, not estimated semantic similarity or document authority.

`diagnostics.assessments` retains the exact requests for traced candidates and
requests that include a traced chunk as supporting context. Each visit includes
stage (`primary`, `context`, `expanded`), candidate/context IDs, local cache status,
full judgment/fingerprint and reported input/output token counts. `expanded` is
an orchestration pass; some visits recheck unchanged primaries without context.
Cache fingerprints continue to include the entire request and rubric version.
Tracing does not change the request or cache key.

Usage is only for the traced visits, **not** total run billing. Missing/invalid
counts, including unavailable original counts for reused judgments, are `null`,
not zero. Local judgment-cache reuse is not provider prompt-cache usage. Provider
cache breakdown, dollar costs, Pi usage, intent and Cloudflare billing remain
unknown unless captured independently. Do not sum partial trace usage into a
claimed end-to-end cost.

## Opt-in bounded shortlist experiment

Only after diagnosing a named gap, compare the default with:

```sh
npm run --silent cli -- search '<same exact frozen question>' --root . \
  --rerank --top-k 5 --diversify --explain --json \
  > /tmp/sift-diversified.json
```

`--diversify` requires hybrid discovery and reranking. It cannot be combined with
`--semantic-only`. No additional vector queries, embeddings or query-intent calls
are introduced. The already computed local lexical ranking admits up to 32
records instead of eight into the merge pool; with at most eight vector and eight
anchor entries, that pool has at most 48 unique records.

Anchors retain priority. Remaining selection favors files with fewer selected
representatives, then sections/source units with fewer representatives, breaking
ties by existing reciprocal-rank order and deterministic ID order. Document
paragraphs share their enclosing section group; continuation pieces share their
unit. Files/units remain eligible on later rounds—there is no seen-chunk or file
hard exclusion. Rankings are discovery heuristics, not relevance or authority.

Both conditions retain the same maximum of eight primary assessment candidates,
eight context candidates, two seeds and two context chunks/16 KiB per seed. The
0.75 default acceptance threshold is unchanged. Fewer available candidates means
fewer assessed candidates, not padding with unrelated evidence. A fixed maximum
assessment budget does not guarantee equal billable tokens, cache hits, selected
context, or actual judgment visits; measure all of these separately.

The full and compact reports expose `shortlist.strategy`, `poolCandidates` and
`lexicalPoolLimit`. The experiment is also labeled in findings, so a diversified
run cannot silently masquerade as the unchanged default. No complete-answer score
is introduced. Source diversity can lose useful same-file evidence and is not a
substitute for question coverage or correctness.

## Validation so far

All **126 credential-free tests** passed, along with typecheck, build, lint,
formatting and diff checks. The passing tests are not real-service evidence.
Regressions cover:

- Complementary sources becoming eligible at the same primary limit in a controlled
  fixture with dominant repeated fragments; ordinary/default selection unchanged.
- Anchor priority, repeated-file eligibility, section/continuation rotation,
  deterministic input-order independence and bounded pool/shortlist losses.
- Exact new/cached judgment requests and fingerprint equality, unchanged assessment
  visit counts with tracing, contextual requests captured when tracing a supporting
  chunk, explicit unknown usage and bounded collision peers.
- Publication absence, discovery/pool/shortlist losses, rejection, context eligibility
  and delivery, output cutoff, CLI pre-provider validation and consistent root resolution.

A local shadow comparison also used 1,873 frozen current semantic records from
`inspect records --root . --json`, with **empty vector input and no assessment**.
It is a local discovery mechanics check, not a semantic-only or live hybrid run.
The source snapshot hash is
`51c6d412a39507720445ba8369315024d7d626bdce3cb672a82ea89710fef790`.

New development probe questions (not reconstructed historical or held-out cases):

1. “How has retrieval evolved from planned semantic search through intermediate
   checkpoints to current hybrid discovery and bounded context?”
2. “What happens during onboarding, how are failures persisted, and what prerequisites
   must be met before publishing?”
3. Literal lookup control: `lexical-index.json`.

| Shadow probe | Default / diversified candidates | Default / diversified files |
| --- | --- | --- |
| Evolution draft | 8 / 8 | 7 / 8 |
| Onboarding draft | 8 / 8 | 6 / 8 |
| Literal control | 3 / 3 | 3 / 3 |

Both broad probes still ranked the glossary first. The literal control kept the
`INDEX_FILE` constant first in both conditions. More files are **not** a measured
coverage gain; required facts for the broad probes are not independently reviewed
or graded. This evidence does not justify enabling diversification by default.

Private temporary artifacts, including the record snapshot, shadow script/results
and test logs: `/tmp/sift-bounded-coverage-Gn0A4u/`. These are not durable storage.
Next gate: refresh onboarding after edits, publish once, freeze the generation,
source-review exact required passages, then trace those IDs and repeat paired
queries with reported stage timings, usage and unknown costs retained explicitly.
Original historical-case recovery and untouched held-out grading remain pending.
