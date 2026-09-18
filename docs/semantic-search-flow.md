# Semantic Search Flow

## Goal

Build a CLI-driven semantic search engine on top of Jev/TypeSafe.

The intended product experience is not grep with better ranking. It is a semantic index created during onboarding, then searched quickly from local persisted meaning.

## Current SDK fact

The installed `@typesafe-ai/sdk` package does not currently expose an obvious `embedding`, `embed`, or `vector` API. Jev is documented as a System One structured decision model: it evaluates typed questions against state and returns structured answers, probabilities, confidence, and scores.

So the design should separate two concepts:

- **Jev semantic signature**: structured meaning produced by Jev.
- **Embedding**: a numeric vector stored in a vector backend.

If TypeSafe/Jev later exposes embeddings directly, it can become the embedding provider. Until then, embeddings are derived from Jev semantic signatures using another embedding provider, or we search signatures directly.

## Onboard/index flow

Command:

```bash
semantic-search onboard <path>
```

Flow:

```txt
codebase
  -> scan files
  -> chunk files
  -> Jev analyzes each chunk
  -> produce semantic signature per chunk
  -> embed signature text/fields
  -> store chunk + signature + vector locally
```

For each chunk, Jev should answer structured questions like:

```ts
{
  purpose: "What is this code responsible for?",
  concepts: "What concepts are represented here?",
  operations: "What actions does this code perform?",
  inputs: "What inputs/configuration does it depend on?",
  outputs: "What does it produce or mutate?",
  risks: "What could break if this changed?",
  domain: "What area of the system does this belong to?",
  searchPhrases: "What natural-language searches should find this?"
}
```

Persisted record shape:

```ts
interface SemanticChunkRecord {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  sourceHash: string;
  textPreview: string;
  signature: {
    purpose: string;
    concepts: string[];
    operations: string[];
    inputs: string[];
    outputs: string[];
    risks: string[];
    domain: string;
    searchPhrases: string[];
    confidence: number;
  };
  embedding?: number[];
}
```

## Search flow

Command:

```bash
semantic-search search "where are credentials configured?"
```

Flow:

```txt
query
  -> Jev turns query into structured search intent
  -> embed query intent
  -> vector lookup against stored semantic signature embeddings
  -> return top candidates
  -> if confidence/results weak: Jev scores top candidate chunks directly
  -> if still weak: optionally expand index with more Jev signatures/embeddings
  -> optional final fallback: lexical/grep search
```

Query intent shape:

```ts
interface SearchIntent {
  kind: "find_implementation" | "find_config" | "find_bug_risk" | "find_usage" | "understand_concept";
  concepts: string[];
  operations: string[];
  domains: string[];
  desiredEvidence: string[];
  negativeSignals: string[];
}
```

## Where Jev fits

### Jev at onboard time

Jev creates durable structured meaning for every chunk. This is the most important use of Jev because it moves expensive semantic work out of the search hot path.

### Jev at query time

Jev converts vague natural-language queries into structured search intent. This makes the search query comparable to the indexed semantic signatures.

### Jev at fallback scoring time

If vector lookup returns weak or ambiguous results, Jev scores candidate chunks against the query intent using typed scores, for example:

```ts
{
  answersQuestion: score("Does this chunk answer the user's search query?"),
  implementsConcept: score("Does this chunk implement the requested concept?"),
  configRelevance: score("Is this chunk relevant to configuration/credentials?"),
  confidence: score("How confident should the search engine be in this result?")
}
```

### Jev for index expansion

If a query reveals missing semantic fields, the engine can create additional signatures for relevant files/chunks and persist them for future searches.

## Where embeddings fit

### Primary embedding target

Embed the Jev semantic signature, not raw source text. The vector represents Jev-interpreted meaning.

### Query embedding target

Embed the Jev query intent, not the raw user query.

### Local first

Store embeddings locally first. Remote Vectorize support comes later as an optional backend for the same records.

## Fallback order

Preferred order:

1. Query intent via Jev.
2. Vector lookup over Jev-derived semantic embeddings.
3. Jev direct scoring over top candidates if vector confidence is weak.
4. Create/update missing semantic signatures and embeddings if needed.
5. Lexical/grep fallback only if semantic methods cannot produce useful candidates.

## Checkpoints

1. Onboard creates semantic signatures for chunks and stores them locally.
2. Search creates a structured query intent with Jev.
3. Search retrieves candidates from stored signatures without string matching.
4. Embeddings are added for signatures and query intents.
5. Weak searches trigger Jev candidate scoring.
6. Weak searches can enrich the index.
7. Vectorize can replace/supplement the local vector backend.
