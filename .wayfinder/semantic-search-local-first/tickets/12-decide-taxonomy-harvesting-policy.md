# Decide taxonomy harvesting policy

Labels: wayfinder:grilling
Parent: Fast Semantic Search Engine on Jev
Status: closed
Assignee: cloakedj
Blocked by: Research universal taxonomy candidate harvesting

## Question

Which language-light candidate harvesters belong in v1 across code-only, text-only, and mixed corpora, and what deterministic normalization, source scoring, provenance, configurable caps, overflow/fairness, and Jev batching policies should they use? Decide front matter format/extension scope and handling of uncertain candidates within the already-approved automatic, soft, reversible taxonomy governance.

Use [Universal taxonomy candidate harvesting](../../../docs/research/universal-taxonomy-candidate-harvesting.md) as evidence, not an approved configuration. Numeric caps and weights are unvalidated proposals. Separate global candidate-pool limits from full request token budgets; a Choice question is not multilabel classification. Preserve rare useful labels and avoid file-order bias. Tree-sitter, NLP pipelines, embedding clustering, and plugin frameworks remain deferred.

## Discussion

### First-round approvals

- Candidate sources: paths/file names, Markdown headings, conservative front matter, Unicode-aware words/short phrases, and heuristic identifier splitting. These propose candidates for Jev governance, not keyword-based retrieval.
- YAML front matter only at the start of `.md`/`.mdx`; extract string/list values for `title`, `description`, `tags`, `categories`, and `keywords`, not arbitrary keys. Reject aliases/custom tags and excessive nesting. Malformed metadata warns without excluding the document.
- Unicode NFC and lowercase matching, preserving original spelling and provenance. Split separators and camel-case identifiers, retaining compound forms and components. No local stemming, singularization, or semantic synonym merging.
- Balance selection across source types and resources with deterministic ordering, not discovery order. Reserve capacity for rare heading/explicit-metadata candidates; make overflow visible.
- User additionally requested line/character locations and chunk size to identify source spans. These are provenance, not semantic candidate labels; the coordinate contract was settled in the next round.

### Second-round approvals

- Source pointers use zero-based half-open byte ranges `[startByte, endByte)` and one-based inclusive display line ranges. Chunk byte size is `endByte - startByte`. Resource hashes identify the file version. Candidate evidence has its own source span where available; paths use resource references. Do not call byte offsets character offsets.
- Configurable initial per-resource candidate caps: 16 path, 20 heading, 30 front-matter, 64 identifier, and 64 body candidates. Label length is capped at 80 Unicode code points, evidence snippets at 240. Initial per-run governance pool is 200 candidates per taxonomy dimension, independent of request-size limits. These are unvalidated tuning defaults.
- Priority order: explicit metadata/headings, paths, identifiers, body phrases. Rank using distinct-resource frequency rather than raw repetition, deterministic tie-breaking, and round-robin resource selection within tiers. Reserve 25% of the pool for rare heading/metadata candidates.
- Uncertain judgments remain pending with evidence, not promoted or deleted. Reconsider on changed evidence/governance configuration or explicit rerun. Failed calls remain retryable failures, not negative judgments. Automatic promotions remain soft and reversible.

### Final-round approvals

- Governance calls carry at most 16 candidates, with at most three evidence snippets from distinct resources per candidate. Budget the entire request, including questions and registry context. Use a configurable initial 16 KB UTF-8 serialized-payload cap as an application guardrail, not a Jev token-limit guarantee. Split oversized batches; record unrecoverable size failures explicitly.
- Judge each candidate independently in each proposed taxonomy dimension using useful / uncertain / unsuitable. Promote only useful judgments with reported confidence at least 0.8; other useful judgments and uncertain judgments remain pending, while unsuitable judgments are recorded as such. The threshold is an uncalibrated starting default, not an accuracy guarantee. Multiple candidates may qualify; one Choice must not stand in for multilabel classification.
- Initially, rare means appearing in at most two distinct resources. Unused reserved capacity returns to the general pool. Apply fairness at resource and global caps and deduplicate before counting slots. Retain overflow candidates locally for explicit reconsideration, without automatically draining overflow through additional paid calls. Exclude overlong labels with a recorded reason rather than truncating them into different labels.
- Body phrases contain one to three words and do not cross sentence or heading boundaries. Front matter is limited to 16 KB and the approved top-level string/string-list fields. Harvest ordinary Markdown headings in `.mdx` without evaluating JSX or expressions.

## Resolution

Approved through live discussion. The approval rounds above are the selected v1 harvesting policy: deterministic, language-light evidence extraction and fair bounded selection, followed by independent Jev governance. They are planning decisions, not measured quality claims or implementation results.

### Relationship to existing decisions

- The source-coordinate contract refines the existing ranges in [Decide semantic record schema](02-decide-semantic-record-schema.md). Locations, lengths, and hashes describe source provenance; they are not taxonomy labels. Byte size can be derived from the range without an independent stored value.
- Candidate harvesting remains the first phase of [Decide onboard pipeline](03-decide-onboard-pipeline.md), after approved discovery/privacy exclusions and before taxonomy governance and chunk classification. Harvesting is not lexical retrieval.
- The limits on the global candidate pool, per-call candidate count, evidence snippets, and full serialized request are separate constraints; satisfying one does not establish compliance with the others or with provider token limits.
- Governance failure, pending judgment, unsuitable judgment, and budget overflow remain distinguishable. None is silently treated as an approved label. Existing automatic, soft, reversible taxonomy governance remains in force.
- Initial caps, rare-candidate reservation, priorities, and promotion confidence require validation at the approved taxonomy/classification checkpoint. Source provenance, excluded/overflow counts, and judgments must be inspectable so missed useful labels and noisy promotions can be diagnosed.
- No additional parsers, NLP pipelines, embedding clustering, or plugin framework are brought into scope. No implementation or paid inference was performed to resolve this ticket.

## Checkpoint unlocked

The taxonomy/classification checkpoint can implement the approved extraction and governance policy, expose candidate evidence and outcomes, and validate it against code-only, text-only, and mixed fixtures.
