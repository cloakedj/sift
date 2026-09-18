# Decide embedding and local vector backend

Labels: wayfinder:grilling
Parent: Fast Semantic Search Engine on Jev
Status: closed
Assignee: cloakedj
Blocked by: Research Jev capabilities for embeddings and structured scoring, Decide semantic record schema, Decide search-time Jev query inference

## Question

How should Cloudflare Workers AI embed Jev-derived semantic records/query intents and Cloudflare Vectorize store/search them from day one? Finalize the embedding model, request path, index configuration, credentials, minimum remote metadata, publication behavior, and first remote checkpoint after API-fit research. The original local-backend title/path is retained for stable references; local storage alternatives are no longer under consideration.

## Current direction — approved Cloudflare pivot

The user explicitly replaced the local-first embedding/vector path to avoid maintaining extra infrastructure and a later migration:

- Jev remains responsible for semantic records and query intent.
- Use Cloudflare Workers AI for embeddings and Vectorize for vector storage/retrieval from day one, subject to API/model-fit verification.
- Keep semantic records and receipts locally. Embedding inputs leave the machine; search requires network access. There is no offline-search promise.
- Drop local embedding models, SQLite vector storage, the exact local cosine scan, and the local-to-Vectorize migration. MiniLM and SQLite were proposals, not selected dependencies.
- Keep the conceptual separation between embedding generation and vector storage, but defer a plugin framework and alternative implementations.
- Retain embedding-space compatibility checks, the 10,000-chunk development target, input/space/role-based reuse, explicit oversized-input errors, and the requirements for resumability, completeness reporting, and no stale vectors. Remote publication/filtering semantics must be checked rather than assumed to match a local backend.
- Model selection, dimensions/metric, CLI-to-Cloudflare request path, credentials, remote metadata, and a concrete checkpoint remain undecided. These include the still-relevant operational questions from the retired migration ticket.

This direction supersedes conflicting approvals below. [Research Cloudflare Vectorize fit](08-research-vectorize-fit.md) is now resolved; the remaining work is the resulting HITL choices.

## Historical discussion — first round (local-first choices superseded)

- Embedding inference is local by default, with a model download during setup and an explicitly selected remote-provider option. This does not make Jev inference offline.
- Target 10,000 chunks for initial local development; measure vector retrieval separately from Jev and embedding latency. Larger-scale indexing is a later adapter upgrade.
- Use embedded persistent storage inside the CLI process, with no required database service or container. Specific backend selection awaits verified runtime compatibility.
- Keep EmbeddingProvider and VectorBackend independent. Storage migration can preserve compatible vectors; a model change requires re-embedding even when dimensions match.
- Version embedding spaces. Never compare incompatible vectors. Build a replacement space separately and switch only when ready; reject queries using the wrong space. Reuse semantic records without repeating Jev classification.

## Historical discussion — second round (subject to the Cloudflare pivot)

Approved:

- Start with exact cosine similarity as a correctness baseline for the 10,000-chunk target, subject to measured latency rather than an assumed performance guarantee.
- Reuse embeddings by exact embedding input, embedding-space identity, and document/query role. Pin model revision and preprocessing settings; chunk IDs and matching vector dimensions alone are insufficient.
- Publish successful embeddings resumably with explicit completeness reporting. Do not serve stale vectors for changed chunks. Keep a replacement space inactive until its required records are ready.
- VectorBackend exposes upsert, delete, query, and space/completeness metadata inspection. Query returns chunk IDs and similarity scores; semantic records remain authoritative outside vector storage. Apply explicit filters before selecting final top results.

- Oversized embedding inputs must be detected and explicitly reported, never silently truncated. Choose a bounded projection after verifying model limits. Confirmed in the follow-up response.

Historical local-candidate research is recorded in [Local embedding and backend candidates](../../../docs/research/local-embedding-backend-candidates.md), now superseded as a selection path. No embedding package/model was installed; only an in-memory built-in SQLite check was executed.

## Checkpoint unlocked

A Jev-derived semantic record and query intent can be embedded with Workers AI and retrieved through Vectorize without source-text string matching. Exact commands and expected remote visibility/completeness behavior await API-fit research.

## Resolution

Use Cloudflare Workers AI and Vectorize directly from the CLI for v1:

- Embedding model: `@cf/baai/bge-base-en-v1.5`.
- Pooling: `cls`, pinned into the embedding-space identity.
- Vectorize index: 768 dimensions, cosine metric.
- Request path: direct CLI REST calls to Cloudflare APIs for v1; no Worker proxy until a concrete need appears.
- Credentials/config: project config names account/index/model defaults, but secrets come from environment variables such as `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
- Vectorize metadata boundary: Vectorize stores operational pointers and hashes, not full Jev semantic records. Full semantic records remain local/source-of-truth for v1.
- Future API/MCP posture: use future service-compatible minimal metadata from the start where it does not complicate v1: `project_id`/`corpus_id`, `resource_id`, `resource_kind`, `chunk_id`, `embedding_space_id`, `semantic_record_version`, and `content_hash` or `semantic_record_hash`. Do not turn Vectorize into the semantic-record database; a future API/MCP service should introduce a separate semantic-record/result store if local files are no longer sufficient.
- Publication behavior: an embedding space becomes active/searchable only after all expected vectors are upserted, async mutation visibility is polled/backed off, and local completeness checks pass. Successful upsert responses alone are not enough.
- Stale vector behavior: for ordinary chunk changes within the same embedding space, upsert the stable vector ID with new values and hashes, and mark local completeness stale until visible. For model, pooling, schema, or preprocessing changes, create a replacement embedding space and keep it inactive until complete.
- First remote checkpoint: `jev search checkpoint cloudflare-vectorize` loads/generates a tiny fixture of Jev-derived semantic records, embeds records with Workers AI, upserts to Vectorize, polls until queryable, embeds a Jev-derived query intent, retrieves the intended chunk semantically, reports expected/upserted/visible/stale/missing completeness, and forbids lexical source-text matching as the pass condition.
- Checkpoint staging: first prove CLI-only minimal metadata works, then add the service-compatible metadata fields as a separate checkpoint layered on top.
