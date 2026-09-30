---
name: sift
description: Use the local Sift CLI for semantic repository retrieval before grep, respecting configured corpus boundaries. Use when answering codebase questions, locating conceptual or cross-file behavior, checking onboarding scope, or comparing Sift with lexical tools. Honor requests not to use semantic search.
---

# Sift repository search

Use Sift as primary discovery for repository questions unless the user requests ordinary file inspection, a lexical baseline, or no semantic search. Run commands from the repository root, not this skill's directory. Shell-quote queries as literal arguments. Sift is the project/CLI; Jev/TypeSafe is an inference provider, not the project name.

## Establish the permitted corpus first

Reading the configuration and this skill is allowed before semantic discovery.

1. Honor the user's requested root and any `--config` override. Read `sift.config.json` at that root, or at the parent of a single-file root. For an explicit config, read that file instead. Without a requested root, check repository-root `sift.config.json`; if present, use the repository root as the corpus. If absent, the default scope is `docs`.
2. Read `discovery.include`, `discovery.exclude`, `respectGitignore`, and `hiddenDirectories` before choosing where to search or verify citations. Patterns are relative to the config directory. Sift does not auto-load ancestor/nested configs. `--root docs` and `--root .` are separate corpora/publications. Do not switch roots to evade exclusions or missing publication.
3. If scope is unclear, preview it without credentials, provider calls, or state writes:

   ```bash
   npm run --silent cli -- onboard '<root>' --dry-run --json
   ```

   Pass the same `--config '<file>'` on this and every subsequent corpus command when using an override. Inspect `configuration`, `resources`, `skipped`, and `failures`. The full behavior is documented in `docs/configuration.md`; command syntax is in `src/cli/README.md`. Do not read `.env` to diagnose setup.
4. Search and citation verification should stay within the selected resources. Includes do not override excludes, `.gitignore`, or built-in safety exclusions. Do not inspect excluded source directories/files or bypass their boundaries with grep unless the user explicitly authorizes a specific non-sensitive scope expansion. If the needed implementation is excluded, report that gap and ask.
5. Do not read credentials, private keys, `.git` internals, dependency/build output, binary artifacts, or `.sift/` state as ordinary evidence. Legacy `.jev/` is also sensitive local state. Prefer `status`, `inspect`, and dry-run output over raw stores; caches/receipts may contain source previews or queries. Only inspect specific state artifacts when explicitly authorized for diagnostics. Hidden directories are denied by default; enabling them does not disable safety exclusions.

Configuration controls Sift selection, not OS permissions or a complete secret detector. User authorization and sensitive-data handling still apply. Do not change config, onboard with inference, or publish just to widen evidence without permission.

## Start compact

For the selected root (shown here as the unconfigured `docs` default):

```bash
npm run --silent cli -- search '<question>' --root docs --rerank --top-k 5 --agent --json
```

`--agent --json` keeps citations, bounded previews, supporting context, evidence status, and coverage warnings without full taxonomy/provenance. `previewTruncated` means read the cited range, not that the remainder is irrelevant. Top-k limits returned results; it does not guarantee five hits or expand the assessment budget.

## Verify before searching again

- No `rg`, `grep`, `find`, or manual source discovery before Sift results, except scope/config inspection above, an explicitly requested lexical baseline, or a user request not to use Sift.
- Read relevant returned ranges and supporting context within the permitted corpus. Combine adjacent/overlapping ranges from the same file into one read; do not reread available source or dump whole files unnecessarily.
- Check every part of the question against the evidence, not just the top score. One file can cover a broad question; multiple files alone do not establish completeness.
- For conversion/handling/persistence questions, trace nearby side effects such as receipts, counters, final state, and writes. Include only relevant details, not an exhaustive subsystem tour.
- Targeted `rg` within an exact Sift-returned file is allowed for verification, not directory-wide discovery. Prefer source already in context.
- If evidence covers the question, answer with paths and line ranges. Stop; do not search again merely to collect more citations.

## Escalate only for a named gap

If evidence remains empty, irrelevant, unclear, or incomplete after verification, identify the missing fact before another call.

For diagnosis, rerun the same command with `--explain` (keep `--agent --json`):

```bash
npm run --silent cli -- search '<question>' --root docs --rerank --top-k 5 --agent --explain --json
```

Explain exposes assessed candidates, including rejected ones; it does not inherently widen retrieval. Rejected candidates are not accepted evidence. Scores are not calibrated truth probabilities.

If a specific gap remains, issue a focused follow-up query naming that gap, using compact agent output. Do not append a fixed list of generic keywords. Continue only while each search addresses a distinct unresolved fact and adds useful evidence.

Repeated follow-ups without resolving the gap should trigger diagnosis, not more query variations. Use `--explain` once for the relevant query if it has not already been explained; do not rerun explain for unchanged results. Explain is not a substitute for a new query when different evidence is needed.

Stop when results repeat, searches stop adding useful evidence, or the remaining gap persists despite diagnosis and focused follow-ups. Disclose what remains unresolved and offer lexical fallback or deeper investigation rather than continuing indefinitely. Respect time, cost, and search budgets.

Use broader lexical discovery only as an explicitly authorized, disclosed fallback after Sift fails to supply needed evidence, or when asked for a baseline/no semantic search. Keep fallback within permitted scope. Execution/provider errors are not evidence that a feature is absent.

For stale/missing publication, check using the same root/config:

```bash
npm run --silent cli -- status --root docs --json
```

Changing selection can invalidate existing publication. Ask before semantic onboarding or publishing unless already authorized. Search/reranking uses provider services and may incur usage. Do not repeatedly retry broken setup.

## Answer boundaries

- Distinguish accepted results, supporting context, and diagnostic candidates.
- `execution: complete` is bounded execution, not exhaustive coverage. Report unresolved gaps honestly; never turn no results into proof of absence.
- Keep raw diagnostics out of the final answer unless requested. Prefer verified source over inferred summaries.
- Baseline comparisons must not invoke Sift search. Use the same permitted question/scope, with separate sessions to avoid answer leakage.
