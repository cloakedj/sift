# Cloudflare Workers AI + Vectorize fit

Research ticket: [Research Cloudflare Vectorize fit](../../.wayfinder/semantic-search-local-first/tickets/08-research-vectorize-fit.md)

## Summary

Cloudflare can support the approved cloud-first path, but the app must own most correctness guarantees: embedding-space identity, completeness, stale-vector prevention, publication state, and retry/resume accounting. Cloudflare supplies hosted embedding inference, dense vector storage/search, metadata filtering, namespaces, async mutation IDs, and listing APIs; it does not supply a domain-specific notion of “all chunks for this source version are embedded and queryable.”

Recommended first configuration for the follow-up decision: Workers AI `@cf/baai/bge-base-en-v1.5` with `pooling: "cls"`, a Vectorize index with `dimensions=768` and `metric=cosine`, direct REST calls from the CLI for both Workers AI and Vectorize, and local Jev semantic records as the source of truth.

## Primary sources read

- Cloudflare Workers AI REST API guide: <https://developers.cloudflare.com/workers-ai/get-started/rest-api/>
- Cloudflare Workers AI model catalog and model schema pages: <https://developers.cloudflare.com/workers-ai/models/>, especially BGE embedding schema files under `/workers-ai/models/bge-*/sync-input.json` and `/sync-output.json`.
- Cloudflare Workers AI limits: <https://developers.cloudflare.com/workers-ai/platform/limits/>
- Cloudflare Workers AI pricing: <https://developers.cloudflare.com/workers-ai/platform/pricing/>
- Cloudflare Vectorize Workers binding API: <https://developers.cloudflare.com/vectorize/reference/client-api/>
- Cloudflare Vectorize metadata filtering: <https://developers.cloudflare.com/vectorize/reference/metadata-filtering/>
- Cloudflare Vectorize limits: <https://developers.cloudflare.com/vectorize/platform/limits/>
- Cloudflare Vectorize pricing: <https://developers.cloudflare.com/vectorize/platform/pricing/>

## Embedding model facts

Workers AI exposes embedding models in the catalog, including:

| Model | Catalog context/pricing facts | Notes for this project |
| --- | --- | --- |
| `@cf/baai/bge-small-en-v1.5` | priced; batch-capable | 384-dimensional upstream BGE small model; cheaper/smaller, but weaker baseline. |
| `@cf/baai/bge-base-en-v1.5` | catalog shows context `153600`, batch-capable, $0.0666 / 1M input tokens | Good default: 768-dimensional upstream BGE base model, below Vectorize’s 1536-dimension cap. |
| `@cf/baai/bge-large-en-v1.5` | priced; batch-capable | 1024-dimensional upstream BGE large model; likely better but more expensive than base. |
| `@cf/baai/bge-m3` | catalog shows context `60000`, low price | Its schema is query/contexts oriented and async-shaped, less straightforward for simple document/query embedding parity. |
| `@cf/qwen/qwen3-embedding-0.6b` | catalog shows context `8192`, low price | Interesting later candidate, but current schema endpoints were not as readily verifiable from docs as BGE v1.5. |

The BGE v1.5 Workers AI input schema accepts `text` as either one string or an array with `maxItems: 100`; it also accepts `pooling: "mean" | "cls"`, defaulting to `mean`. Cloudflare’s schema warns that `cls` can generate more accurate embeddings on larger inputs but is not compatible with `mean`; therefore pooling must be part of the embedding-space identity. Output contains `shape`, `data` arrays of floating-point vectors, and `pooling`.

The Workers AI REST guide uses `POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{model}` with `Authorization: Bearer {API_TOKEN}`. Its token guidance says custom tokens need `Workers AI - Read` and `Workers AI - Edit` permissions.

Workers AI rate limits are per task type/model; the limits page calls out `@cf/baai/bge-large-en-v1.5` at 1500 requests/minute. Because BGE batch input allows up to 100 texts per request, initial onboarding should batch embedding documents, but also persist per-input success so retries do not duplicate work.

## Vectorize fit

Vectorize vectors have:

- `id`: unique string, max 64 bytes.
- optional `namespace`: partition key; operations are per namespace.
- `values`: dense number array whose length must match index dimensions.
- optional `metadata`: up to 10 KiB per vector.

Queries return closest vectors according to the configured distance metric. Query options include `topK` (default 5), `returnValues`, and `returnMetadata: "none" | "indexed" | "all"`. Current Vectorize limits allow `topK=100` without values/metadata and `topK=50` with values or metadata.

Upsert is the right mutation for indexing chunks: it inserts missing IDs and overwrites existing IDs, replacing vector values and metadata in full. Inserts/upserts/deletes are asynchronous, return a mutation identifier, and “typically” take a few seconds to become queryable/removable. Therefore the app cannot treat a successful upsert response as immediate search readiness.

Vectorize supports listing vector IDs with pagination up to 1000 IDs per page. That is enough for reconciliation/completeness checks, but local records should remain authoritative.

## Metadata and filters

Metadata filtering is suitable for coarse constraints, not for storing semantic records. Important constraints:

- `filter` is applied before top-K selection.
- Namespace filtering is built in and is applied before metadata filters.
- Non-namespace metadata filtering requires creating metadata indexes first, up to 10 metadata indexes per Vectorize index.
- Supported metadata index types: `string`, `number`, `boolean`.
- String metadata indexes use only the first 64 bytes per indexed property, truncated on UTF-8 character boundaries.
- Vectors upserted before metadata indexes are created are not indexed for those filters until re-upserted.
- Filter JSON must be compactly under 2048 bytes.

Minimum remote metadata should be small and operational: `resource_id`, `chunk_id`/stable local pointer, `semantic_record_version`, `embedding_space_id`, `content_hash` or `semantic_record_hash`, and optionally coarse indexed filters such as `resource_kind` and `project_id`. Do not put full Jev semantic records in Vectorize metadata; keep them local.

## Limits and cost shape

Current Vectorize limits support the 10,000-chunk development target comfortably: max dimensions 1536, max upsert batch size 1000 via Workers or 5000 via HTTP API, max vectors per current index 20,000,000, max metadata 10 KiB/vector, and max vector upload size 100 MB.

Vectorize billing is based on queried vector dimensions and stored vector dimensions, not active index hours or number of indexes. Cloudflare’s pricing examples show small costs at 384/768 dimensions for tens of thousands of vectors and queries, so 10,000 chunks should be inexpensive.

Workers AI prices embedding models by input tokens. Published embedding prices include BGE small/base/large and Qwen/BGE-M3 candidates; cost depends on the deterministic embedding document length and retry behavior.

## Guarantees the app must implement

Cloudflare provides vector mutation and retrieval primitives; the search engine must implement:

1. **Embedding-space identity**: include model id, provider, dimensions, metric, pooling, preprocessing/projection version, semantic record schema version, and query/document role if role-specific prompts are used.
2. **No silent truncation**: prefer models/inputs where length can be bounded. For models with truncation flags, set them to error rather than truncate when available; otherwise preflight token/length limits conservatively.
3. **Publication state**: do not mark an embedding space active until all required chunk vectors are upserted and visible enough for the checkpoint.
4. **Stale-vector prevention**: derive vector ID from stable chunk ID plus embedding-space identity, or keep old and new spaces separate; delete or supersede changed chunk vectors based on local content/semantic hashes.
5. **Resumability**: persist per-chunk embedding input hash, embedding response, upsert attempt/mutation ID, and observed remote state.
6. **Completeness reporting**: reconcile local expected vector IDs against Vectorize list/query/get APIs; report missing, stale, pending, and extra vectors.
7. **Eventual mutation visibility**: poll/backoff after upserts before declaring a checkpoint passed.

## Recommendation for the next HITL decision

Use this as the default unless the user wants a larger model immediately:

- Embeddings: `@cf/baai/bge-base-en-v1.5`.
- Pooling: `cls`, pinned in `embedding_space_id`.
- Vectorize index: 768 dimensions, cosine metric.
- Request path: direct REST from CLI first; defer a Worker unless secrets, batching, or gateway controls require it.
- Namespace: one namespace per local project/index root or configured corpus.
- Metadata indexes: create before any upsert for only the filters needed in MVP, likely `resource_kind`, `project_id`/corpus id, and maybe `semantic_record_version`; rely on local records for rich filtering/reranking.
- Checkpoint: embed a small fixed fixture of Jev-derived semantic records, upsert to Vectorize, poll until queryable, then query a Jev-derived intent embedding and retrieve by semantic meaning without source-text string matching.
