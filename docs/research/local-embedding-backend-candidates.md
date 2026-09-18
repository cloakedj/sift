# Local embedding and backend candidates

## Status

Historical candidate research. The user subsequently approved Workers AI embeddings and Vectorize from day one; the local model/SQLite selection path is superseded. No proposed dependency here was installed or adopted.

## Scope

Evidence for [Decide embedding and local vector backend](../../.wayfinder/semantic-search-local-first/tickets/05-decide-embedding-and-local-vector-backend.md). These are candidates, not approved selections. Research was performed directly because this session has no background-agent tool.

## Observed environment

- `package.json`: TypeScript, Node ESM, tsx; no embedding/vector dependency installed.
- `node --version`: v26.8.1; `process.platform`/`process.arch`: darwin arm64.
- An in-memory `node:sqlite` import and `select sqlite_version()` succeeded, returning 3.53.4. No repository database was created.

## Primary-source findings

- [Sentence Transformers all-MiniLM-L6-v2 model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/blob/main/README.md): English, Apache-2.0, 384-dimensional sentence/short-paragraph embeddings; default truncation beyond 256 word pieces. Example uses attention-mask-aware mean pooling and L2 normalization. This is not evidence of sufficient quality on our Jev-derived documents.
- [Xenova ONNX conversion model card](https://huggingface.co/Xenova/all-MiniLM-L6-v2/blob/main/README.md): explicitly compatible with Transformers.js; example uses `@huggingface/transformers`, feature extraction, mean pooling, normalization, and Float32 output with 384 dimensions.
- [Transformers.js README](https://github.com/huggingface/transformers.js/blob/main/README.md): ONNX runtime, configurable model location, and `env.allowRemoteModels = false`. Provision artifacts first, then disable remote model loading for local-only operation. No package or model has been installed here.
- [ONNX Runtime Node binding requirements](https://github.com/microsoft/onnxruntime/blob/main/js/node/README.md): Node 16+ documented (20+ recommended); prebuilt CPU binaries listed for macOS arm64. This supports plausibility, not a verified end-to-end run on our exact Node/package/model combination.
- [Node SQLite docs](https://github.com/nodejs/node/blob/main/doc/api/sqlite.md): built-in `node:sqlite`, introduced in Node 22.5; current main docs mark release-candidate stability. `DatabaseSync` is synchronous. It supplies persistence, not the proposed cosine search implementation.

Sources above are moving main-branch/model-card references; implementation must pin package and model revisions rather than treating these URLs as immutable artifacts.

## Recommendations awaiting user decision

1. Baseline model: `Xenova/all-MiniLM-L6-v2` through Transformers.js on CPU, pinned artifact revision and explicit dtype, mean pooling and normalized output. Use a conservative 256-token total input cap including special tokens, validated with the actual tokenizer without truncation. English-first baseline; not a multilingual or code-retrieval quality guarantee.
2. Persistence: `.jev/vectors.sqlite` using `node:sqlite`, holding embedding-space metadata, vector rows, fingerprints, and publication/completeness state. Keep semantic records authoritative outside it. Exact cosine search runs in the adapter over eligible vectors, not a SQLite vector extension.
3. At 10,000 x 384 float32 values, vector payload alone is 15,360,000 bytes (~14.65 MiB), excluding IDs, metadata, database/runtime overhead, and model memory. This is arithmetic, not a memory or latency benchmark.
4. Detect/report overlength documents for the initial checkpoint; do not silently discard fields to fit the model. If representative documents frequently overflow, reopen projection/model choice rather than accepting a mostly unsearchable corpus.

## Validation still required

- Pin and smoke-test actual package/model/dtype revisions and token counting on the supported Node version.
- Measure cold startup, embedding inference, vector loading, and exact search separately.
- Validate relevance on Jev-derived record/query projections; model-card intended use is not acceptance evidence.
- Test publication atomicity, stale-vector exclusion, filtered top-k, interruption recovery, and wrong-space rejection during implementation checkpoints.
- Vectorize compatibility remains with its existing research/migration tickets; nothing here proves it.
