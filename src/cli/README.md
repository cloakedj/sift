# Sift CLI

Run the CLI through npm:

```sh
npm run cli -- <command> [options]
```

Most commands accept `--json` for structured output. Commands that operate on a corpus accept `--root <path>`; some also accept a positional root for convenience.

With no explicit root or `--config`, corpus commands find the nearest ancestor `sift.config.json` from cwd and use its directory as the root and `.sift/` location (falling back to cwd). Explicit `--root`, positional roots, and `--config` retain existing scope; `--config` alone does not change the root. `--no-discover-config` opts out of ancestor lookup. Explicit roots load only their own config (a file root uses its parent). Use overrides consistently across commands. Patterns are config-directory-relative; nested configs are not merged. Human output reports the resolved scope; JSON includes `resolvedRoot`, `configPath`, and `stateDirectory`. Legacy lexical-search JSON wraps its array in `results`. See [configuration](../../docs/configuration.md) for all options, precedence, safety rules, and `.sift/` state migration.

Semantic onboarding, query intent, reranking, and relevance benchmarks may call Jev/TypeSafe. Publishing and semantic retrieval use Cloudflare Workers AI and Vectorize in the current implementation. See the repository README for Cloudflare setup.

## Commands

### `help`

Print usage.

```sh
npm run cli -- help
npm run cli -- --help
```

### `onboard`

Discover resources, chunk them, classify chunks, and write local semantic records under `.sift/` at the target root (or the parent for a single-file root).

```sh
npm run cli -- onboard [root] [--root <path>] [--config <file>] [--dry-run] [--limit <chunks>] [--concurrency <n>] [--resume] [--rerun-governance | --no-rerun-governance] [--json]
```

Options:

- `--config <file>`: load an alternate configuration instead of the root's `sift.config.json`.
- `--dry-run`: inventory selected resources and chunks only; no model calls, writes, or publication. JSON includes the resolved config and skipped paths/reasons. Configured onboarding settings are ignored in this mode.
- `--limit <chunks>`: process at most this many chunks; the remainder are deferred, leaving incomplete onboarding.
- `--concurrency <n>`: positive integer classification concurrency.
- `--resume`: remove an existing `.sift/onboarding.lock` before starting semantic onboarding. Use only after verifying no Sift writer is still active.
- `--rerun-governance`: rerun taxonomy governance during semantic onboarding.
- `--no-rerun-governance`: override a configured `rerunGovernance: true`.
- `--json`: emit the manifest or inventory as JSON.

Explicit options override configuration, then built-in defaults. Classification, governance, and recovery flags cannot be combined with `--dry-run`.

Examples:

```sh
npm run cli -- onboard . --dry-run
npm run cli -- onboard --root . --limit 25
npm run cli -- onboard . --resume
```

### `inspect`

Inspect local records, taxonomy state, or validation status.

```sh
npm run cli -- inspect records --root <path> [--json]
npm run cli -- inspect taxonomy --root <path> [--json]
npm run cli -- inspect validation --root <path> [--json]
```

Use `records` for semantic chunk records, `taxonomy` for promoted/pending taxonomy state, and `validation` for completeness and projection diagnostics.

### `repair-projections`

Rebuild current embedding projection text for existing complete records without reclassifying chunks.

```sh
npm run cli -- repair-projections --root <path> [--json]
```

Use this after projection-version changes when records are otherwise current.

### `publish`

Embed current semantic records and publish vectors to Cloudflare Vectorize.

```sh
npm run cli -- publish --root <path> [--json]
```

Requires Cloudflare configuration and a Vectorize index compatible with the pinned embedding space: 768 dimensions, cosine metric, Workers AI `@cf/baai/bge-base-en-v1.5`, and `cls` pooling.

### `status`

Report local publication status for a root.

```sh
npm run cli -- status --root <path> [--json]
```

This checks local publication completeness and recorded visibility. It does not by itself republish vectors.

### `search`

Run semantic retrieval against the active publication.

```sh
npm run cli -- search <query> [--root <path>] [--top-k <n>] [--anchor <literal>] [--semantic-only] [--rerank] [--min-relevance <0..1>] [--explain] [--agent --json] [--json]
```

Options:

- `--top-k <n>`: limit returned results. Retrieval caps apply internally.
- `--anchor <literal>`: add one or more literal anchors for hybrid discovery. Repeatable.
- `--semantic-only`: disable lexical-anchor discovery and use semantic/vector discovery only.
- `--rerank`: use Jev to judge candidate relevance after vector discovery.
- `--min-relevance <0..1>`: with reranking, withhold evidence below this score. Default is `0.75`.
- `--explain`: include diagnostic details, rejected candidates, intent, scores, provenance, and coverage.
- `--agent --json`: emit compact machine-oriented search output with citations, bounded previews, evidence status, and coverage warnings. `--agent` requires `--json`.
- `--json`: emit the full structured result.

Examples:

```sh
npm run cli -- search "how does retrieval work?" --root .
npm run cli -- search "session expiry checks" --root . --rerank --explain
npm run cli -- search "where are vectors published?" --root . --agent --json
npm run cli -- search "auth flow" --root . --anchor "createJevClient" --top-k 5
```

### `search --show-intent`

Infer and print the structured query intent without running retrieval.

```sh
npm run cli -- search <query> --show-intent [--root <path>] [--json]
```

`--show-intent` cannot be combined with retrieval options such as `--rerank`, `--top-k`, `--semantic-only`, `--anchor`, `--min-relevance`, or `--explain`.

### `index`

Build a legacy lexical diagnostic index.

```sh
npm run cli -- index [root] [--root <path>] [--json]
```

This is not semantic search and is intended for diagnostics.

### `lexical-search`

Run legacy lexical diagnostic search.

```sh
npm run cli -- lexical-search <query> [--root <path>] [--json]
```

This is not semantic search and does not use the vector publication path.

### `generate-scale-corpus`

Generate a synthetic corpus for scale and benchmark experiments.

```sh
npm run cli -- generate-scale-corpus --root <path> --chunks <n> [--kind code|text|mixed] [--json]
```

Options:

- `--chunks <n>`: target estimated chunk count.
- `--kind code|text|mixed`: generated corpus type. Defaults to `mixed`.

### `benchmark-summary`

Summarize one or more benchmark report files.

```sh
npm run cli -- benchmark-summary <report.json...> [--json]
```

### `evaluate-relevance`

Evaluate a relevance cases file at a cutoff.

```sh
npm run cli -- evaluate-relevance <cases.json> --top-k <n> [--json]
```

This reports benchmark metrics only; it is not a semantic quality pass by itself.

### `benchmark-relevance`

Run a relevance benchmark suite against prepared corpora.

```sh
npm run cli -- benchmark-relevance <suite.json> --root <corpora-parent> --top-k <n> --policy answer-if-any|rerank-min-relevance --run-paid [--rerank --min-relevance <0..1>] [--json]
```

Options:

- `--run-paid`: required acknowledgement because the command can call paid external services.
- `--policy answer-if-any`: count a case as answered if retrieval returns any answerable evidence.
- `--policy rerank-min-relevance`: require reranking and `--min-relevance`.
- `--rerank`: enable Jev candidate judgments.
- `--min-relevance <0..1>`: relevance threshold for the rerank policy.

## Typical workflow

```sh
# Optional: create sift.config.json, then preview its selected corpus.
npm run cli -- onboard . --dry-run
npm run cli -- onboard .
npm run cli -- inspect validation --root .
npm run cli -- publish --root .
npm run cli -- status --root .
npm run cli -- search "how is publication validated?" --root . --rerank
```
