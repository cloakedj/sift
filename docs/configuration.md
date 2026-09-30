# Repository configuration

Sift automatically loads **`sift.config.json`** from the selected corpus root. For a single-file root, it checks that file's parent. It does not search ancestors, merge nested configs, or execute JavaScript/TypeScript configuration.

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

## Onboarding options

| Option | Default | Meaning |
| --- | --- | --- |
| `limit` | No limit | Positive integer cap on classified/reused chunks for this run. Remaining chunks are deferred and the run is incomplete. |
| `concurrency` | `3` | Positive integer classification concurrency. |
| `rerunGovernance` | `false` | Rerun taxonomy governance instead of reusing saved decisions. |

Explicit CLI/programmatic options override config values, which override built-in defaults:

```sh
npm run cli -- onboard . --limit 25 --concurrency 2
npm run cli -- onboard . --no-rerun-governance
```

`--rerun-governance` and `--no-rerun-governance` are mutually exclusive. Dry runs validate the whole config but ignore its onboarding settings; explicit classification/governance flags with `--dry-run` are rejected. Avoid a persistent `limit` unless you intentionally want incomplete onboarding.

Provider selection, credentials, chunker limits, taxonomy thresholds, and publication settings are not configuration-file options in this version. Unknown keys, unsupported versions, malformed JSON, and invalid option types fail explicitly rather than silently falling back.

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

To retain an old store, stop all Sift processes, ensure no writer is active, and rename `.jev` to `.sift` **only if `.sift` does not already exist**. Never merge two state directories or delete an active lock. Keep the corpus root unchanged, then run `status`/inspection. If both stores exist, preserve both and choose a recovery strategy before proceeding. Both names remain Git/tooling/discovery exclusions to protect old artifacts. Renaming local state does not rename provider models or remote Vectorize indexes.

## Validation scope

Credential-free tests cover parsing, config discovery/overrides, path-relative selection, nested ignore rules, safety exclusions, dry-run behavior, controlled onboarding precedence, scope changes, and `.sift` persistence. These are configuration/mechanics checks, not real-service semantic-quality evidence.
