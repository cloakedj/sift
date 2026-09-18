# Define development checkpoints

Labels: wayfinder:grilling
Parent: Fast Semantic Search Engine on Jev
Status: closed
Assignee: cloakedj
Blocked by: Decide onboard pipeline, Decide search-time Jev query inference, Decide search ranking and fallback flow

## Question

What are the concrete checkpoints for developing and validating the semantic search engine? Define commands, fixtures/corpus, expected output, pass/fail criteria, and what each checkpoint proves about Jev, embeddings, vector retrieval, scoring, fallback, and performance.

## Resolution

Approved through live discussion. These are development gates proving observable behavior, architecture, and capabilities—not component coverage targets. This is a plan, not evidence that any checkpoint has passed.

### Command and fixture contract

Use product commands through `npm run cli -- …`, with ordinary test assertions around output; no dedicated checkpoint commands. Shared `--root <fixture>` and `--json` options support isolated, repeatable validation. The commands below are planned capabilities, not claims about today's lexical CLI. This supersedes earlier dedicated checkpoint-command proposals.

Use three small, checked-in fixture scopes: code-only, text-only, and mixed code/documents. Share some conceptual queries across scopes and add resource-kind-specific cases. Use this repository as an additional smoke test, not as the sole corpus or a fixed correctness oracle.

Human-authored expectations define correct resources. For each curated answerable query, an expected resource must appear in the top three ahead of lexical distractors. Include paraphrases, negative preferences, explicit filters, and unanswerable queries; the latter must not yield high-confidence claims. Semantic cases include correct chunks without the query terms in raw text and wrong-meaning distractors containing those terms. Fixture behavior, not Jev grading itself, is the acceptance oracle.

### Nine checkpoints

All commands below follow `npm run cli --` and select the relevant fixture root.

| Checkpoint | Product commands | Observable pass criteria |
| --- | --- | --- |
| Resource discovery and chunk inventory | `onboard <root> --dry-run` | Expected resources and bounded chunks are reported; denylisted resources are absent; unchanged input produces stable identity; no inference expenditure or publication is needed. |
| Jev semantic records | `onboard <root>`; `inspect records --root <root>` | Real Jev inference produces valid, source-linked semantic records for fixture chunks, with deterministic embedding projections and visible failure accounting. |
| Taxonomy and classification | `inspect taxonomy --root <root>` | The same onboarding run exposes harvested candidates, governed taxonomy, and chunk classifications. This is a separate proof view, not a second pipeline or an instruction to classify before taxonomy exists. Harvester selection remains in Research universal taxonomy candidate harvesting. |
| Query intent | `search "<query>" --root <root> --show-intent` | Real Jev-derived intent is observable; valid reuse and invalidation follow the approved versioned cache contract; inference failure cannot silently bypass Jev. |
| Cloudflare embedding and publication | `onboard <root>`; `status --root <root>` | Real Workers AI embeddings and Vectorize retrieval visibility are demonstrated; status reports expected/upserted/visible/stale/missing completeness. Upsert acceptance alone cannot pass. Prove minimal metadata first, then service-compatible metadata. |
| Semantic retrieval | `search "<query>" --root <root> --explain` | Fixture relevance gates pass without lexical retrieval; explanation shows semantic execution and ranking evidence. |
| Conditional Jev scoring | `search "<ambiguous-query>" --root <root> --explain` | Weak/ambiguous conditions trigger actual Jev scoring within configured candidate bounds; strong cases can avoid it; explanation reports triggers and scores. Several equally relevant results must not automatically be treated as irrelevant. |
| Opt-in lexical recovery | Search with and without `--lexical-fallback --explain` | Lexical recovery occurs only when explicitly enabled and is labeled; without it, weak semantic candidates carry warnings rather than silently becoming lexical results. |
| Scale and performance | The same onboarding/search commands on 1,000- and 10,000-chunk corpora | Report indexing stages and search per-stage/end-to-end p50/p95, separating uncached intent, cached intent, and Jev-reranked searches. This establishes a baseline, not proof of an as-yet-unselected latency budget. |

### Cross-cutting behavioral checks

- Interrupted onboarding resumes and reuses completed work.
- Changed/deleted resources never appear as current; incomplete/stale publication is visible.
- Incompatible embedding spaces cannot mix.
- Cache invalidation follows input/version changes.
- Missing credentials and service failures are explicit, never a silent lexical substitute.
- Ordinary search does not mutate semantic records; enrichment is explicit.
- Use controlled failures for repeatability alongside real-service checks.
- Credential-free deterministic checks can run independently. Remote checks must be explicitly distinguished as not run when unavailable; mocks do not prove Cloudflare or Jev behavior.

### Measurement, tuning, and later work

Separate tuning queries from held-out acceptance queries. Freeze configuration before acceptance runs and record model/configuration versions. Ranking thresholds, confidence mappings, and candidate limits are selected through this process rather than guessed to be calibrated now.

Measure latency before choosing hard numerical budgets. Fast-enough acceptance remains open until measured evidence supports a budget; detailed benchmark data and run protocol still need specification.

Real Jev calls remain part of feature checkpoints, but designing a comprehensive integrated test suite that grades scenarios against the actual Jev API is deferred until all checkpoints are in place. Do not assume identical API outputs on repeated calls; later test design must address variability and grading policy.

An installable standalone CLI is deferred until features are in place. `npm run cli` is sufficient now; final executable name, packaging, and installation validation are not selected.

## Checkpoint unlocked

Implementation can proceed checkpoint-by-checkpoint with visible progress and no hidden assumptions about correctness or speed.
