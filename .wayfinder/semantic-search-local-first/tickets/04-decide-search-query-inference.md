# Decide search-time Jev query inference

Labels: wayfinder:grilling
Parent: Fast Semantic Search Engine on Jev
Status: closed
Assignee: cloakedj
Blocked by: Decide semantic record schema

## Question

How should Jev act as the inference plane during search? Decide how raw user queries become structured search intent: intent type, concepts, operations, domains, expected evidence, negative signals, expansion terms, confidence, and whether query inference is always required or cached/offline-capable.

## Resolution

Approved through two rounds of live discussion and confirmed by the request to continue. This records the search-time inference contract, not an implementation.

### Intent and reuse

- Jev query inference is mandatory by default; a validated cache hit may reuse it. Any future raw/lexical diagnostic path must be explicit, not the default.
- Use the domain term **Query intent**, recorded in `CONTEXT.md`.
- Mirror semantic-record taxonomy with scored concepts, operations, domains, dependencies, risks, and evidence kinds. Include raw query, schema version, intent kind, positive terms, negative signals, optional expected answer shape, confidence, and a deterministic embedding document.
- Classify against the current taxonomy registry; retain unmatched candidates for possible future enrichment without mutating the taxonomy during inference.
- Cache by raw query, taxonomy registry version, query-intent question-set version, and model version.
- Planned checkpoint: `npm run cli -- search "where are credentials configured?" --show-intent` prints structured intent before retrieval. Stubbed or explicitly identified lexical retrieval is acceptable only for this checkpoint, not proof of completed semantic retrieval.

### Failure behavior and intent construction

- Without a valid cached intent, retry transient Jev failures within a bounded budget, then return an explicit error. Never silently bypass inference or switch to lexical search.
- Inferred labels and negative signals are ranking preferences, not hard exclusions. Only explicit CLI filters exclude results.
- Intent kinds: `find_implementation`, `find_configuration`, `find_usage`, `find_explanation`, `find_risk`, and `other`.
- Extract candidate phrases deterministically from the raw query, then use Jev scoring/classification for positive terms, negative signals, and unmatched candidates. No freeform generation is required.
- Optional expected answer shape uses a fixed choice (implementation, configuration, example, or explanation), not generated prose.
- Build the query embedding document deterministically from the raw query and positively scored intent fields in stable order. Keep structured negative signals separate for scoring; do not append excluded concepts as positive embedding targets. The retained raw query may itself contain negation.

Retrieval weights and thresholds belong to [Decide search ranking and fallback flow](06-decide-search-ranking-and-fallback.md); concrete retry budgets and validation coverage belong to [Define development checkpoints](07-define-dev-checkpoints.md). A valid cached intent avoids a new Jev inference call; it does not guarantee an entirely offline search, which also depends on the embedding provider and retrieval backend.

This resolution unblocks [Decide embedding and local vector backend](05-decide-embedding-and-local-vector-backend.md). No additional decision tickets surfaced.

## Checkpoint unlocked

`search "..."` can show the Jev-derived structured query intent before retrieval, proving that the search is not raw string matching.
