# Research Jev capabilities for embeddings and structured scoring

Labels: wayfinder:research
Parent: Fast Semantic Search Engine on Jev
Status: closed
Assignee: cloakedj
Blocked by:

## Question

What does Jev/TypeSafe currently expose that this search engine can use: direct embeddings, typed scores, choices, confidence/probability distributions, batching behavior, latency expectations, API limits, and SDK ergonomics? Determine whether "Jev embeddings" are a real API capability or whether embeddings must be produced by a separate provider from Jev-generated semantic signatures.

## Checkpoint unlocked

The plan can name Jev's exact technical role without guessing: direct embedding provider, structured semantic signature provider, query inference plane, candidate scorer, or some combination.

## Resolution

Findings: [Jev capabilities for embeddings and structured scoring](../../../docs/research/jev-capabilities-for-search.md)

Jev/TypeSafe does not currently expose a documented direct embeddings API in the public docs or installed JavaScript SDK. Use Jev as the structured semantic-signature provider during onboarding, structured query-intent provider at search time, and typed candidate scoring/reranking layer. Numeric embeddings should be produced by a separate embedding provider over Jev-derived semantic records/query intents unless TypeSafe later ships an embedding endpoint.
