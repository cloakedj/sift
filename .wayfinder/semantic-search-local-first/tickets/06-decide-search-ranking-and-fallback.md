# Decide search ranking and fallback flow

Labels: wayfinder:grilling
Parent: Fast Semantic Search Engine on Jev
Status: closed
Assignee: cloakedj
Blocked by: Decide search-time Jev query inference

## Question

What is the search execution flow after Jev query inference? Decide vector retrieval thresholds, how Jev structured scores rerank or rescue weak results, when to create additional embeddings/signatures, when to fall back to lexical grep, and how confidence is reported to the user.

## Resolution

Approved through live grilling. This records the search execution policy after valid Jev query intent exists; exact numeric thresholds and checkpoint budgets belong to [Define development checkpoints](07-define-dev-checkpoints.md).

- Normal ranking starts with Vectorize similarity over Jev-derived embeddings, then applies lightweight structured boosts/penalties from the query intent fields. Jev scoring is not invoked for every successful search.
- Jev scoring is triggered when semantic retrieval is weak or ambiguous: low top similarity, narrow margin between top results, too few candidates, or low query-intent confidence.
- When invoked, Jev scoring judges whether each candidate answers the query, contains the expected evidence kind, matches positive concepts/operations/domains, conflicts with negative signals, and is safe to show as high-confidence. It returns typed numeric fields plus final relevance confidence.
- Negative signals demote results; they do not hard-exclude candidates unless the user supplied explicit CLI filters.
- The number of candidates sent to Jev scoring is configurable. The default shape should be a bounded adaptive set, such as top candidates plus near-ties around the cutoff, with concrete defaults set by checkpoints.
- Lexical fallback is opt-in for v1, e.g. `--lexical-fallback`, and must be clearly labeled. Normal search either returns semantic results or reports weak/failed semantic confidence; it does not silently become grep.
- If semantic confidence remains weak and lexical fallback is not enabled, return the best low-confidence semantic candidates with a warning and suggest rerunning with lexical fallback or an enrichment/repair command.
- Search-time index expansion should not mutate the index silently. Missing semantic fields/signatures should be handled by an explicit repair/enrich command rather than automatic writes during ordinary search.
- User-facing confidence is shown as readable labels by default, such as high/medium/low. Verbose or explain output can expose vector similarity, Jev relevance scores, trigger reasons, and fallback status.

## Checkpoint unlocked

A search can retrieve via semantic vectors first, invoke Jev scoring for weak/ambiguous candidates, report confidence clearly, and use lexical fallback only when explicitly requested.
