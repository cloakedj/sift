# Retrieval and synthesis evaluation

Status: protocol prepared; historical cases and independent grading are **not yet frozen**.
The [small-fixture benchmark](../relevance-benchmark.md) remains a development
regression suite, not a held-out answer evaluation. Passing credential-free tests
is not real-service evidence.

Completed development steps:
- [Numbered previews and fixed-report validation](numbered-previews.md).
- [Chunk-boundary repair and fixed-source validation](chunk-boundaries.md) (new-generation live retrieval pending).
- [Target diagnostics and opt-in bounded diversification](bounded-coverage.md) (default policy unchanged; live comparison pending).

These do not complete the historical freeze or held-out grading gates.

## 1. Freeze before intervention

Copy [the case template](case-template.json) into a private artifact directory
outside the permitted corpus. Never commit raw traces or answers by default.
Keep original artifacts immutable; record SHA-256, byte size, and capture time
for every artifact. A hash proves identity, not completeness or independent review.
Do not collect credentials, raw provider bodies, or stacks. Record any redaction
and hash the retained version; do not imply it is the untouched original.

Preserve exact question and prompt bytes, ordered messages, skill bytes/version,
model/provider and effective settings, tool permissions, cwd, root and explicit
config path, resolved selection and configuration bytes. Record source revision,
tracked changes and explicitly selected non-sensitive untracked inputs: a Git
patch alone does not capture untracked files. Exclude `.sift/` and legacy `.jev/`
from reference discovery. Do not copy those stores wholesale.

Save publication generation and configuration through supported diagnostics.
Capture full retrieval reports (not only `--agent` projections), ordered tool
requests/responses, final answers, wall-clock and stage timings, reported usage,
and known cache state. Identify missing artifacts explicitly. Unknown cost is
`null` with a reason, never zero. Keep Pi and Sift/provider usage separate and
record whether totals include backend calls to avoid double counting. Do not
infer cache hits or cost from latency. Provider failures are failures, not
insufficient-evidence outcomes.

Existing artifacts must be copied rather than regenerated under a newer source,
publication, skill or model. Newly collected baselines must be labeled as new runs.
Discovery performed while preparing this protocol is not a frozen baseline.

## 2. Independently review cases

A reviewer uses pinned sources, not retrieval scores or the tested answer, to
record required facts and exact source ranges; prerequisites, relevant side
effects and limitations; historical/proposed/current status; acceptable
abstentions; and unsupported claims. Record reviewer identity and review time.
An author-created draft is not independent adjudication.

Separate development cases from untouched held-out questions before tuning.
Keep held-out material out of development prompts and search corpora. Include
simple literal/path lookup controls where semantic retrieval may lose. Use
identical scopes, configurations, permissions and starting directories for
paired runs. Record authorized lexical fallback and actual tool use separately:
a semantic-assisted run with broad grep is not semantic-only success.

Export only anonymized answer text and an opaque answer ID to graders. Keep the
ID-to-condition mapping, tools, costs, timings and raw artifacts private. Preserve
source citations needed to grade accuracy while redacting identifying local path
prefixes. Flag self-disclosed condition names for review. Freeze the rubric and
then the completed grades before revealing conditions or costs. Grade required
facts, unsupported claims and citation accuracy, not answer length.

## 3. Fixed-evidence synthesis first

Replay the same frozen, ordered evidence pack to both skill variants. Disable
retrieval tools in this experiment; requests for additional evidence can be
recorded, but must not change either pack. Record evidence-pack hashes and
missing facts. This isolates synthesis and stopping from retrieval quality.

Use this checklist (internal working notes, not mandatory final-answer padding):

| Question part | Required fact | Evidence found | Remaining gap |
| --- | --- | --- | --- |
| Exact subquestion | Source-review requirement | Artifact + source range, or none | Named fact, or none |

Before another search, name the missing fact and check the already retrieved/read
evidence. Stop if a call would repeat evidence or merely add citations. Before
answering, check prerequisites, relevant side effects and limitations; verify
literal paths, constants, defaults and ranges; separate current from historical
or proposed behavior; inspect existing interfaces before recommending abstractions.

Measure required-fact coverage, unsupported claims, redundant calls and latency.
Keep per-candidate relevance, execution/coverage, agent question coverage and
final correctness separate. **Supported means accepted evidence exists; it does
not establish complete question coverage.** Do not introduce a completeness score
without validation.

## 4. Stage gates

1. Freeze cases, source reviews, baseline artifacts and grading protocol.
2. Compare checklist synthesis with fixed evidence; add source-line previews with
   explicit full-chunk versus displayed ranges and clipping. Verify source text
   alignment before assigning line numbers. Measure duplicate primary/context
   excerpts before changing serialization; preserve judgments, relationships,
   acceptance/diagnostic distinctions and coverage warnings.
3. Check heading-only fragments against saved reports. Test heading ancestry,
   labels/lists, fences and explanations, oversized continuations, exact byte/line
   boundaries and deterministic IDs. Run local regressions first. Changed chunk
   identities require re-onboarding and republication; old generations cannot
   validate the new chunker.
4. Trace each missing passage through inventory/publication, discovery, shortlist,
   available context, assessment and output cutoff. Inspect embedding collisions
   and exact judgment inputs. Use evolution and onboarding development questions.
   Test bounded aspect discovery/diversification at fixed assessment cost before
   raising budgets or lowering thresholds.
5. Run repeated, fully costed held-out A/B trials after development decisions are
   frozen. Report correctness, fact coverage, unsupported claims, citations,
   workflow compliance, end-to-end/stage latency, Pi/backend costs, cached versus
   uncached usage, and unique evidence versus cumulative processed tokens.
   Unknown measurements remain unknown; repetitions are separate observations.

No seen-chunk hard exclusion: repetition may be necessary context. Document titles,
heading ancestry and explicit status labels are evidence; filename/date alone
cannot establish authority.

## Separate operational track

Review stale-lock resume independently of quality experiments. Test whether an
active writer's lock can be removed, preserve ownership checks and resumable state,
and require explicit intervention when safety cannot be established. Retrieval
quality results do not validate recovery safety.
