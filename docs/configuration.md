# Repository configuration

When a corpus CLI command has no explicit root or `--config`, Sift searches from the working directory upward for the nearest **`sift.config.json`**. Its directory becomes the corpus root, and `.sift/` assets are located there. If no config exists, the root remains the working directory. Nested configurations win; configurations are never merged or executed as JavaScript/TypeScript.

This applies consistently to `onboard`, `inspect`, `publish`, `status`, `search` (including `--show-intent`), `repair-projections`, `index`, and `lexical-search`. Benchmark and fixture-generation commands retain their existing explicit scope.

Explicit `--root` (or an onboarding/index positional root) disables ancestor discovery. `--config` also disables discovery and retains the existing default root of cwd; it does not relocate state. Use `--no-discover-config` for cwd-only behavior without a root override. With explicit roots or discovery disabled, configuration is loaded only at the selected root (or a file root's parent). Programmatic services retain this root-local behavior.

Human-readable corpus output reports the root, config, and state location. JSON objects include `resolvedRoot`, `configPath` (null when absent), and `stateDirectory`; legacy lexical-search arrays are now returned under `results` alongside these fields. No state is moved or migrated. Existing subdirectory corpora should use an explicit root or `--no-discover-config` to preserve their identity.

For example, from `src/retrieval/`, `sift search "retry behavior"` uses the nearest configured corpus rather than creating a new subdirectory corpus. Preview selection with `onboard --dry-run --json` before paid work.

```json
{
  "version": 1,
  "discovery": {
    "include": ["src/**", "docs/**", "README.md"],
    "exclude": ["**/*.test.ts", "docs/archive/**"],
    "respectGitignore": true,
    "hiddenDirectories": true
  },
  "onboarding": {
    "concurrency": 4,
    "rerunGovernance": false
  }
}
```

Put this file at your corpus root, adjust the selection, then preview it without credentials, inference, state writes, or publication:

```sh
npm run --silent cli -- onboard . --dry-run --json
npm run cli -- onboard .
npm run cli -- publish --root .
npm run cli -- search 'how does authentication work?' --root . --rerank
```

The dry-run JSON contains `configuration` (loaded path, pattern base, validated config), selected `resources`/`chunks`, `skipped` paths with reasons, and discovery failures. Omitted options in `configuration.config` use the defaults below. Non-JSON dry runs also list selected resources and skip reasons. A pruned directory is reported once, not once per descendant.

## Discovery options

| Option | Default | Meaning |
| --- | --- | --- |
| `include` | All otherwise permitted files | Array of relative file globs; `[]` selects no files. |
| `exclude` | `[]` | Array of relative globs; matching directories prune their entire subtree. |
| `respectGitignore` | `false` | Apply root and nested `.gitignore` files within the configuration scope. |
| `hiddenDirectories` | `true` | Skip directories whose names begin with `.`. Set `false` to allow hidden directories, subject to other exclusions. |

Patterns use minimatch syntax (`*`, `**`, `?`, braces, character classes, extglobs), `/` separators, and are **relative to the directory containing the config**, not the shell's working directory. Matching is case-sensitive and globs can match dotfiles, but safety/hidden-directory rules still apply. Use `src/**` for a subtree, `README.md` for one root file, or `**/*.test.ts` at any depth. A trailing `/` is shorthand for `/**`.

Includes only select files: a nonmatching parent directory is still traversed to find matching descendants. Excludes take precedence over includes. Absolute patterns, `..` segments, backslashes, leading `!`, empty patterns, and non-string patterns are rejected. For selection negation, use `exclude`, not `!` include patterns.

When enabled, `.gitignore` uses Git-style matching, comments, escapes, and negation. Nested rules can override ancestor file rules; an ignored directory is pruned, so a descendant negation cannot re-include files inside it. Symlinked `.gitignore` files are not followed. Sift does not read global Git excludes, `.git/info/exclude`, or ignore files above the configuration directory. With an explicit config and a narrower root, ancestor ignore files between the config directory and that root are also applied. Git tracked-file status is not consulted: matching tracked files are excluded too.

### Safety boundaries

Configuration adds selection rules; it does **not** disable the built-in denylist in `src/inventory/consts.ts`. Dependency/build directories, `.git`, `.sift`, legacy `.jev`, known credential filenames/private keys, and known binary extensions remain excluded even if an include matches. The active configuration file and any `sift.config.json` are not indexed. Symlinks encountered during resource traversal are skipped, and binary/invalid UTF-8 resources are rejected by the reader.

These rules are not a complete secret detector or OS access sandbox. Review dry-run output before paid onboarding: permitted text can be sent to external model/embedding providers. Do not put credentials in the configuration; keep provider credentials in the existing environment/auth mechanisms.

## Search options

`search.fusion` tunes how hybrid search fuses vector results with the keyword lane. All fields are optional:

```json
{ "version": 1, "search": { "fusion": { "lexicalScorer": "bm25" } } }
```

- `lexicalScorer`: `bm25` (default; Okapi BM25 over path + text) or `legacy` (the previous term/substring scorer).
- `method`: `rrf` (default), `convex` (normalized score blend, uses `alpha` in 0..1) or `dense` (no keyword lane; vectors plus anchors).
- `rrfK` (default 60) and `lexicalWeight` (default 1): reciprocal-rank offset and keyword-lane weight.
- `route` with `identifierLexicalWeight`: opt-in, off by default; applies a separate keyword weight to identifier-like queries.

`search --lexical-scorer bm25|legacy|none` overrides `lexicalScorer` for one search; `none` is dense-only.

`search.verifyCache` (default `true`) controls the index verification cache. Before its first Cloudflare query for the active publication, search checks the remote Vectorize index (768 dimensions, cosine) and, when no `CLOUDFLARE_ACCOUNT_ID` is set, discovers the account with `wrangler whoami`. With the cache on, a successful check is recorded in `.sift/verified-target.json` (schema version, a hash key, the non-secret account ID, index and model, and a timestamp; never tokens or other credentials) and reused by later searches for up to one hour. The key covers the verified publication (fingerprint/namespace, verification time, source index run, backend and model) and the `CLOUDFLARE_VECTORIZE_INDEX`, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_WORKERS_AI_MODEL` settings, so a new publication or a configuration change re-verifies. `publish` deletes the entry. If Cloudflare rejects a search that used a cached verification (for example, the index was deleted or recreated), search drops the entry, re-verifies, retries once, and adds an info finding; a failed re-verification fails exactly as it would without the cache. Set it to `false` to verify on every search:

```json
{ "version": 1, "search": { "verifyCache": false } }
```

## Onboarding options

| Option | Default | Meaning |
| --- | --- | --- |
| `limit` | No limit | Positive integer cap on classified/reused chunks for this run. Remaining chunks are deferred and the run is incomplete. |
| `concurrency` | `3` | Positive integer classification concurrency. |
| `rerunGovernance` | `false` | Rerun taxonomy governance instead of reusing saved decisions. |
| `labelCache` | `true` | Reuse per-label Jev answers keyed by chunk content and question, so a taxonomy change only asks about new labels. |
| `stableTaxonomy` | `true` | Reuse taxonomy judgments per candidate identity; only newly harvested candidates are judged. |
| `stickyTaxonomy` | `true` | Sticky governance (see below). Set `false` for the previous behavior. |
| `stickyEvidenceIds` | `"relhash"` | Sticky mode only: how governance evidence names its source file. `"relhash"`, `"path"`, `"hash"` or `"none"` (see below). |
| `stickyPromoteConfidence` | `0.85` | Sticky mode only: Jev confidence a new label needs to be promoted, a number in (0, 1]. Active labels stay while confidence is at least 0.7. |

Explicit CLI/programmatic options override config values, which override built-in defaults:

```sh
npm run cli -- onboard . --limit 25 --concurrency 2
npm run cli -- onboard . --no-rerun-governance
```

### Sticky taxonomy

With `stickyTaxonomy` (default `true`), taxonomy governance keeps labels stable across edits and checkout locations:

- Every judgment is archived in `.sift/taxonomy-archive.json`, so a candidate that leaves the bounded candidate pool and later returns is not re-judged and does not flip.
- Promotion uses hysteresis: a new label needs confidence of at least `stickyPromoteConfidence` (0.85), and an active label is kept while it stays at or above 0.7. This prevents labels from flipping near a single threshold because of Jev run-to-run noise.
- Active labels whose term still occurs in the corpus stay active even when they drop out of the 200-candidate pool.
- Candidates and evidence are ordered by repo-relative path instead of by absolute-URI hash, so the selected pool does not depend on where the repository is checked out.

Without it, every edit that shifted the candidate pool could add or drop labels, and each new label re-asks every chunk. Measured on the Sift (jev) and ky benchmark corpora, sticky governance cut Jev input tokens on edit steps by 67% on jev (155,814 → 51,706, no repo-wide re-asks) and 19% on ky. Search quality was unchanged within run noise.

`stickyEvidenceIds` controls how the evidence snippets sent to Jev during governance name their source file:

- `"relhash"` (default): an opaque SHA-256 of the repo-relative path. It is identical at any checkout location and shows no readable filename.
- `"path"`: the repo-relative path. Also location-independent, but the readable filenames shifted the ky taxonomy and cost 1–2 of 62 queries at R@5 (0.847 vs 0.879).
- `"hash"`: the legacy absolute-URI resource ID. It changes when the repository moves; on ky an alternate checkout path dropped R@5 to 0.839.
- `"none"`: no source name. Not recommended: the ky taxonomy collapsed to 8–11 labels.

`"relhash"` is the default because it was the only option that kept ky R@5 within noise of the previous behavior (0.871 vs 0.879) and produced identical governance prompts at two checkout paths. Changing any sticky option, or upgrading from a release without sticky governance, reruns governance once on the next onboarding.

```json
{ "version": 1, "onboarding": { "stickyTaxonomy": true, "stickyEvidenceIds": "relhash" } }
```

`--rerun-governance` and `--no-rerun-governance` are mutually exclusive. Dry runs validate the whole config but ignore its onboarding settings; explicit classification/governance flags with `--dry-run` are rejected. Avoid a persistent `limit` unless you intentionally want incomplete onboarding.

Provider selection, credentials, chunker limits, taxonomy thresholds (other than `stickyPromoteConfidence`), and publication settings are not configuration-file options in this version. Unknown keys, unsupported versions, malformed JSON, and invalid option types fail explicitly rather than silently falling back.

## Alternate configuration and shared scope

Use `--config <file>` (or `--config=<file>`) to override automatic discovery. Its path is relative to the working directory; an explicit missing file is an error. The selected root must be inside the config directory. The override changes selection/settings, **not** the root or local-state location.

```sh
npm run cli -- onboard . --config sift.local.json --dry-run
npm run cli -- onboard . --config sift.local.json
npm run cli -- inspect validation --root . --config sift.local.json
npm run cli -- publish --root . --config sift.local.json
npm run cli -- status --root . --config sift.local.json
npm run cli -- search 'retry behavior' --root . --config sift.local.json --rerank
```

Reuse the same root and override across commands. It is not persisted as a pointer for later invocations. Multiple configs for one root share one store, not independent indexes. Inspection, publication currency checks, hybrid discovery, reranking, and lexical diagnostics resolve selection through the same inventory service. Legacy lexical search filters saved hits against current permitted chunks; rebuild its index to add newly included files.

Changing the selected corpus can make existing semantic records/publication incomplete or stale. Rerun onboarding and publish before semantic search; editing config never silently republishes or deletes remote vectors. `status` is the supported way to check readiness. Choosing `--root docs` is a separate corpus from `--root .`; it does not inherit `./sift.config.json` automatically.

Programmatic callers can provide the `ConfigurationPath` Effect reference for an explicit file. `Configuration`/`ConfigurationLive` supplies the loader; `InventoryService` applies selection centrally, and `OnboardingService` merges onboarding defaults. Existing source-level `DiscoveryPolicy` overrides remain available to programmatic inventory callers.

## Local state rename

New state is written under **`.sift/`**, including manifests, records, receipts, taxonomy, publication data, intent/reranking caches, locks, and the lexical diagnostic index. Older releases used `.jev/`; there is no automatic runtime migration or fallback read.

To retain an old store, stop all Sift processes, ensure no writer is active, and rename `.jev` to `.sift` **only if `.sift` does not already exist**. Never merge two state directories or delete an active lock. If semantic onboarding was interrupted and you have verified no Sift writer is active, `onboard --resume` removes `.sift/onboarding.lock` before taking a new lock. Keep the corpus root unchanged, then run `status`/inspection. If both stores exist, preserve both and choose a recovery strategy before proceeding. Both names remain Git/tooling/discovery exclusions to protect old artifacts. Renaming local state does not rename provider models or remote Vectorize indexes.

## Validation scope

Credential-free tests cover parsing, config discovery/overrides, path-relative selection, nested ignore rules, safety exclusions, dry-run behavior, controlled onboarding precedence, scope changes, and `.sift` persistence. These are configuration/mechanics checks, not real-service semantic-quality evidence.
