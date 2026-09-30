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

## Cloudflare setup

Sift's current semantic retrieval path is cloud-backed. It stores source records locally, but uses Cloudflare for the vector side:

- **Workers AI** generates 768-dimensional embeddings with the pinned `@cf/baai/bge-base-en-v1.5` model.
- **Vectorize** stores those embeddings and performs nearest-neighbor retrieval.

Create or reuse a Vectorize index with 768 dimensions and cosine distance:

```sh
npx wrangler login
npx wrangler vectorize create sift --dimensions=768 --metric=cosine
export CLOUDFLARE_VECTORIZE_INDEX=sift
```

If Wrangler cannot infer the account, also set:

```sh
export CLOUDFLARE_ACCOUNT_ID=<account-id>
```

Alternatively, set `CLOUDFLARE_API_TOKEN` with access to Workers AI and Vectorize.

Then publish vectors before semantic search:

```sh
npm run cli -- onboard .
npm run cli -- publish --root .
npm run cli -- search "how does retrieval work?" --root .
```

`search` requires a complete current publication. Cached Jev intent can reduce model calls, but query embedding and vector lookup still use Cloudflare in the current implementation.

## Can Cloudflare be replaced?

Yes in the design, but not yet by configuration alone. Sift treats the embedding provider and vector backend as replaceable responsibilities: produce compatible vectors, persist them, query them, and prove the active publication is complete and current. The present implementation ships one concrete backend: Workers AI plus Vectorize.

Replacing Cloudflare would require another publication/retrieval adapter that preserves the same contracts: embedding-space identity, dimensions and metric checks, namespace or generation isolation, metadata validation, stale-source detection, resumable publication, and source-linked result validation.

## Repository configuration

Place `sift.config.json` at the corpus root to configure file selection and onboarding defaults:

```json
{
  "version": 1,
  "discovery": {
    "include": ["src/**", "docs/**", "README.md"],
    "exclude": ["**/*.test.ts"],
    "respectGitignore": true
  },
  "onboarding": { "concurrency": 4 }
}
```

`onboard` picks it up automatically. Preview with `npm run cli -- onboard . --dry-run` before inference. Corpus commands share these rules; use the same `--root` and optional `--config <file>` for onboarding, inspection, publication, and search. Local state lives in `.sift/`.

See [configuration](docs/configuration.md) for matching rules, overrides, safety defaults, and migration from the old `.jev/` store. The repository search skill is [sift](.agents/skills/sift/SKILL.md).

## CLI usage

See [src/cli/README.md](src/cli/README.md) for every CLI command, option, and the usual onboarding/publish/search workflow.

## Development

```sh
npm install
npm run test
```

Useful checks before committing:

```sh
npm run format
npm run lint
npm run format:check
```
