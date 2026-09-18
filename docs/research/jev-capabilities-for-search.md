# Jev capabilities for embeddings and structured scoring

## Question

What does Jev/TypeSafe currently expose that this search engine can use: direct embeddings, typed scores, choices, confidence/probability distributions, batching behavior, latency expectations, API limits, and SDK ergonomics? Determine whether "Jev embeddings" are a real API capability or whether embeddings must be produced by a separate provider from Jev-generated semantic signatures.

## Bottom line

"Jev embeddings" are not a currently documented TypeSafe API capability. The public TypeSafe API and installed JavaScript SDK expose System One evaluation (`POST /v1/systemone`) plus model listing (`GET /v1/models`), not an embedding/vector endpoint. For this project, treat Jev as the structured semantic/signature, query-intent, and candidate-scoring layer. Numeric embeddings should come from a separate embedding provider over Jev-created semantic records and query intents unless TypeSafe later ships an embedding API.

## Findings

### Exposed API surface

- The TypeSafe HTTP API documents one evaluation endpoint, `POST https://api.typesafe.ai/v1/systemone`, where a `state`, `model`, and map of typed `questions` return structured `answers` plus `usage` token counts. Source: TypeSafe API reference, <https://docs.typesafe.ai/api.md>.
- The models page documents `GET /v1/models` for available model names/aliases. Source: TypeSafe models docs, <https://docs.typesafe.ai/models.md>.
- The installed `@typesafe-ai/sdk@0.6.0` exports `TypeSafeClient.systemOne(...)`, `client.models.list()`, question builders (`choice`, `score`, `noul`), typed response interfaces, retry/error types, and configuration. It does not export an embedding, vector, or semantic-record generation API. Source: `node_modules/@typesafe-ai/sdk/dist/index.d.mts` and package README.

### Direct embeddings

- No direct embedding endpoint, SDK method, or response type appears in the official docs index fetched from <https://docs.typesafe.ai/llms.txt>, the downloaded TypeSafe docs, or the installed JavaScript SDK declarations.
- TypeSafe’s own use-case docs say Jev can "replace or supplement embeddings in RAG pipelines with semantic search, scoring, and ranking," which frames Jev as an alternative/complement to embeddings rather than an embedding provider. Source: TypeSafe use-case map, <https://docs.typesafe.ai/concepts/use-case-map.md>.

### Structured scoring and classification

Jev can directly support candidate scoring/reranking with typed questions:

- `Score` rates a state against an ordered rubric and returns `score`, `legend`, `probabilities`, and `confidence`. Source: TypeSafe Score docs, <https://docs.typesafe.ai/primitives/score.md>.
- `Choice` selects from defined options and returns `choice`, `probabilities`, and `confidence`. Source: TypeSafe API/primitives docs, <https://docs.typesafe.ai/api.md> and <https://docs.typesafe.ai/primitives.md>.
- `Noul` answers a yes/no judgment with a 0–1 `noul` probability and no separate confidence field. Source: TypeSafe primitives docs, <https://docs.typesafe.ai/primitives.md>.
- Score and Choice confidence is derived from the returned probability distribution; the full probabilities are also returned so the application can compute its own uncertainty metric. Source: TypeSafe confidence docs, <https://docs.typesafe.ai/confidence.md>.

### Batching behavior

- Multiple questions can be sent in one request against the same state, and docs state each question is evaluated independently/in parallel; adding questions "barely changes" or "typically doesn't add" latency, though extra questions still cost tokens. Sources: TypeSafe introduction, <https://docs.typesafe.ai/introduction.md>; TypeSafe fan-out pattern, <https://docs.typesafe.ai/patterns/fan-out.md>.
- The practical request budget is described as around 32,000 tokens / roughly 150,000 English characters shared by state and questions. Source: TypeSafe primitives docs, <https://docs.typesafe.ai/primitives.md>.
- A Choice question accepts up to 255 options; a Score rubric needs at least two levels and supports up to 10 levels. Sources: Choice docs, <https://docs.typesafe.ai/primitives/choice.md>; Score docs, <https://docs.typesafe.ai/primitives/score.md>.

### Latency and limits

- TypeSafe positions System One/Jev as fast, structured decisions and cites "real-time speeds (150ms)" in use-case material; treat that as product positioning rather than a per-request SLA unless confirmed by account docs or measurement. Source: TypeSafe use-case map, <https://docs.typesafe.ai/concepts/use-case-map.md>.
- Current model docs list Jev 1.13 (`jev-1.13.0`) with aliases `jev-latest` and `jev-preview`, and rate limits of 250,000 tokens/second and 1,200 requests/minute, with a warning that limits can change dynamically. Source: TypeSafe models docs, <https://docs.typesafe.ai/models.md>.
- The API can return `429 Too Many Requests`; SDKs retry with backoff and honor retry headers by default. Sources: TypeSafe API reference, <https://docs.typesafe.ai/api.md>; TypeSafe models docs, <https://docs.typesafe.ai/models.md>.

### SDK ergonomics

- JavaScript SDK requires Node.js 20+, reads `TYPESAFE_API_KEY`, defaults to `jev-latest`, and infers answer types from supplied questions. Source: JavaScript SDK docs, <https://docs.typesafe.ai/sdk/javascript.md>.
- Client config includes `apiKey`, `baseURL`, `defaultModel`, log level/logger, retry policy, timeout, default headers, browser opt-in, and custom fetch. Defaults include `TYPESAFE_BASE_URL`/`https://api.typesafe.ai`, `TYPESAFE_DEFAULT_MODEL`/`jev-latest`, log level `warn`, and timeout 10s per attempt. Source: installed SDK declaration, `node_modules/@typesafe-ai/sdk/dist/index.d.mts`.
- `APIPromise.withResponse()` exposes parsed data plus the raw HTTP response and request id; `asResponse()` can return the raw `Response`. Source: installed SDK declaration, `node_modules/@typesafe-ai/sdk/dist/index.d.mts`.

## Implications for the search plan

- Onboarding should use Jev to create a structured semantic signature for each chunk via typed `Choice`/`Score`/`Noul` questions, not to obtain a vector.
- Search-time inference should use Jev to turn a user query into a structured query intent/signature using the same primitive style.
- Vector retrieval should embed the Jev-derived record/query intent with a separate embedding provider and store those vectors in the selected local vector backend.
- Weak or ambiguous vector results should be rescored/reranked by Jev with explicit `Score` questions over `{ query_intent, candidate_signature, candidate_chunk }`, using `score`, `probabilities`, and `confidence` for thresholds.
- Keep the architecture adapter-based so a future TypeSafe embedding endpoint can replace the external embedding provider without changing semantic-record or vector-backend decisions.
