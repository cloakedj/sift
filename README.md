# Sift

Sift is a model-assisted context layer for source repositories. It turns files, docs, and other text-bearing resources into source-backed retrieval records, then answers search requests with cited evidence and clear limits instead of pretending a single model knows the whole codebase.

Package name:

```txt
@cloakedj/sift
```

## The idea

Large repositories contain more context than a model or a person can keep in view at once. Sift narrows that space in stages:

1. **Inventory the repository**: read source resources and preserve their source structure, such as files, document sections, declarations, and nearby context.
2. **Chunk meaningful units**: split resources into bounded retrieval chunks while keeping links back to the original source and neighboring evidence.
3. **Derive semantic records**: use a classifier or other model to describe intent, concepts, actions, risks, APIs, and domains for each chunk. Jev can be one classifier, but the system is designed around replaceable model-backed judgments.
4. **Retrieve candidates**: combine lexical anchors, semantic signatures, embeddings, vector lookup, and source relationships to find likely evidence.
5. **Rerank and explain**: judge whether candidates actually support the query, return citations, and report coverage or truncation limits.

The result is not a chatbot answer engine. Sift supplies the relevant, source-backed context that agents, tools, or humans can use to answer a task more reliably.

## Why “Sift”

The name reflects the job: separate useful semantic signal from repository noise. The project is not tied to a specific classifier model; it can sift with Jev, embeddings, lexical discovery, or future retrieval strategies.

## Development

```sh
npm install
npm run cli -- search "how does retrieval work?" --root .
npm run test
```

Useful checks before committing:

```sh
npm run format
npm run lint
npm run format:check
```
