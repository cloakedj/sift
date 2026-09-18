# Fast Semantic Search Engine on Jev

Labels: wayfinder:map

## Destination

A build-ready plan for a fast semantic search engine built on top of Jev/TypeSafe, where Jev is used during onboarding and searching: onboarding creates structured meaning for code chunks, search-time Jev inference turns user queries into structured intent, embeddings/vector retrieval search those Jev-derived meanings, and Jev scoring handles weak or ambiguous results before any lexical fallback.

## Notes

- Jev is TypeSafe’s System One model; it is a dependency/capability, not the product being built.
- The product is a developer-facing semantic alternative to grep, not a string-matching wrapper.
- The preferred flow is: Jev semantic records at onboard time, Jev query intent at search time, vector lookup over Jev-derived embeddings, Jev scoring/reranking for weak results, lexical fallback only if needed.
- Cloudflare from day one is the approved direction; see the current-direction discussion in [Decide embedding and local vector backend](tickets/05-decide-embedding-and-local-vector-backend.md). Its original title/path is retained for reference stability; API-fit and configuration choices are recorded in its resolution.
- Use domain-modeling when terminology changes.
- Use grilling for HITL decisions.
- Planning is the default; implementation resumes only at explicit checkpoints.
- Checkpoints must be testable with concrete commands and expected behavior.

## Decisions so far

- [Research Jev capabilities for embeddings and structured scoring](tickets/01-research-jev-capabilities.md): Jev is not currently a documented direct embedding provider; use it for semantic signatures, query intent, and typed scoring while embeddings come from a separate provider over Jev-derived records.
- [Decide semantic record schema](tickets/02-decide-semantic-record-schema.md): Use a generalized resource-oriented semantic chunk record with stable resource facts, Jev-scored taxonomy labels, deterministic embedding documents, plugin facets, and append-only onboarding receipts kept outside the search-critical path.

- [Decide onboard pipeline](tickets/03-decide-onboard-pipeline.md): Configurable denylist, bounded generic chunking with optional Jev refinement, two-phase taxonomy/classification, reusable local records, and explicit resumable partial runs.

- [Decide search-time Jev query inference](tickets/04-decide-search-query-inference.md): Mandatory, version-cached Jev intent with taxonomy-aligned preferences, deterministic embedding input, and explicit failure rather than silent bypass.
- [Research Cloudflare Vectorize fit](tickets/08-research-vectorize-fit.md): Cloudflare supports the cloud-first path, with BGE base/CLS plus Vectorize as the recommended default while completeness, publication, and stale-vector guarantees remain app-owned.
- [Decide embedding and local vector backend](tickets/05-decide-embedding-and-local-vector-backend.md): Use Workers AI BGE base with CLS pooling and Vectorize 768/cosine via direct CLI REST, with app-owned publication/completeness, minimal service-safe metadata, and a staged remote checkpoint.
- [Decide search ranking and fallback flow](tickets/06-decide-search-ranking-and-fallback.md): Rank by Vectorize first, trigger configurable bounded Jev scoring for weak or ambiguous retrieval, report confidence labels, and require opt-in lexical fallback.

- [Define development checkpoints](tickets/07-define-dev-checkpoints.md): Nine behavior-driven gates use product commands across code, text, and mixed fixtures, with real-service proof and measured performance before latency budgets.

- [Research universal taxonomy candidate harvesting](tickets/10-research-universal-taxonomy-candidate-harvesting.md): Primary-source comparison supports language-light harvesting plus Jev governance, with plugins deferred; policy and budgets are resolved separately.

- [Decide benchmark corpus and measurement protocol](tickets/11-decide-benchmark-corpus-and-protocol.md): Curated fictional relevance fixtures, pinned real-source scale corpora, and cache-separated, failure-aware measurements define the benchmark plan without selecting latency budgets.

- [Decide taxonomy harvesting policy](tickets/12-decide-taxonomy-harvesting-policy.md): Language-light extraction with precise source provenance, fair bounded candidate selection, and independent Jev judgments defines v1 harvesting; uncertain candidates remain pending.

## Not yet specified

<!-- No remaining in-scope fog for the build-ready plan. -->

## Out of scope

- Building Jev itself; Jev is provided by TypeSafe.
- Treating grep/string matching as the primary product experience.
- Hosted search product or multi-user SaaS in this effort; using managed Cloudflare infrastructure does not change that boundary.
- [Decide Vectorize migration path](tickets/09-decide-vectorize-migration.md): closed as out of scope because the approved Cloudflare-first path has no local vector backend to migrate.
- Local embedding models, local vector storage, an offline-search promise, and a plugin framework/alternative backends are deferred to avoid the complexity rejected in the approved Cloudflare pivot.
- Detailed integrated Jev scenario grading and repeatability policy are deferred until all feature checkpoints are in place; real Jev calls still belong in feature validation.
- Standalone CLI packaging, executable naming, and installation validation are deferred until features are in place; npm invocation suffices for this plan.
- Hard latency budgets and final calibrated ranking defaults are deferred until the approved checkpoints produce measurement evidence; this plan defines how to measure, not the final budgets.
- Post-MVP CLI/user experience work such as watch mode, incremental indexing, final result presentation, and editor integration is deferred beyond this build-ready plan.
