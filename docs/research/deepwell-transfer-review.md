# Deepwell / Locus: ideas transferable to this context layer

## Scope and evidence

Reviewed the local `../deepwell` checkout, its linked GitHub issue decisions, the issue-26 prototype report and its generating source, and this project's current inventory/retrieval code. Research performed directly because no background-agent tool was available. No architecture changes, provider calls, or benchmarks were performed. Recommendations below are proposals, not adopted decisions.

Deepwell's README calls the project **Locus**, a resource-general context layer. Its main checkout's `index.ts` is a hello-world entry point, not a retrieval implementation. Its value here is primarily design reasoning. Some prototypes live on separate branches. [D1, D2]

**Evidence correction:** issue 26 reports a successful held-out incremental-reuse validation, but the inspected script hard-codes each scenario's recomputation counts, metadata counts, and mismatch arrays. `summarize()` aggregates these supplied values and checks thresholds; it does not implement revision trees, execute edits, discover dependencies, or compare computed artifacts against a clean rebuild. Therefore its reported zero mismatches and 12/12 improvements are not empirical validation, even of a working synthetic dependency engine. The scenarios remain useful test specifications. This finding is specific to the inspected issue-26 script; no equivalent code audit of other prototypes was performed. [D6, D7]

## 1. Separate source organization, derived context, and search

Locus distinguishes a resource tree (what exists), a context tree (derived understanding), and search indexes (how to discover references). It explicitly permits cross-hierarchy dependencies and does not require separate databases for these responsibilities. [D2, D5]

**Transfer:** retain these logical distinctions without implementing three new systems:

- Source structure: units, original ranges, parentage, continuation, explicit references.
- Derived context: Jev classifications and relevance judgments, with their inputs/provenance.
- Discovery: semantic and lexical candidate lookup.

This is directly useful to our code/prose discussion. A source unit can be a declaration, a heading-defined section, or a paragraph; bounded retrieval chunks are pieces of those units, not their identities. AST parsing is then a source-specific extraction mechanism rather than a universal domain requirement.

Current gap: `InventoryChunk.structure` imports `ChunkStructure` from `inventory/syntax/types.ts`; that contract includes `symbol`, `exported`, and `mode: syntax | bounded`. Prose already splits at heading/blank-line boundaries, but emits bounded structures with empty relationship arrays rather than section parentage. Retrieval compensates with nearest same-file chunks. [J1–J3]

**Smallest candidate change:** a source-neutral unit/relationship contract populated by existing AST extraction and a heading/paragraph extractor. Keep AST-specific metadata optional. Do not add summary trees or a graph database merely to obtain this separation.

Terminology caution: Locus uses **Resource** for a corpus, whereas this project uses it for a source item/file. Transfer the distinction, not its glossary wholesale. Locus also includes cross-revision correspondence in its source-unit definition; that stronger capability is not necessary for an initial generalization. [D2, J6]

## 2. Distinguish similarity, connectivity, and coverage

Locus's GraphRAG review separates three needs: find matching evidence, follow connections to evidence that may not match directly, and cover a broad corpus. It recommends ordinary discovery plus selective typed expansion before graph diffusion or generated knowledge graphs. [D3]

**Transfer:** semantic/lexical discovery finds seeds; structural links propose supporting context; Jev assesses whether the retrieved evidence actually helps. This preserves our existing bounded expansion rather than replacing it.

Current code already separates eligibility from assessed relevance, expands one hop, and caps seed/context counts and bytes. That is an existing strength, not a new Deepwell feature to build. [J3, J4]

Concrete cases:

- Code: a matching method leads to its class context or an explicitly resolved reference.
- Prose: a matching paragraph leads to its heading, continuation, or another paragraph in the same section.
- Neither case justifies treating the whole file as relevant.

Potential failure worth testing: independently requiring supporting chunks to answer the query can reject a useful definition or heading that only makes sense alongside its seed. Current expansion independently judges context before combined assessment. A bounded pair-aware comparison could test this, but is not automatically justified as another inference stage. [J3, J4]

Broad requests such as “summarize all policy changes” require coverage beyond one seed neighborhood. Do not imply that deeper graph walking solves that separate problem. [D3]

## 3. Anchors unify exact lookup and semantic discovery

Locus's context contract accepts caller-supplied anchors: locations, symbols, diagnostics, literal strings, and earlier findings. An anchor directs discovery without automatically restricting all supporting evidence to that location. Without anchors, discovery returns candidate entry points and visible ambiguity. [D2, D4]

**Transfer:** an exact error string, section heading, product name, or function name can seed the same retrieval/expansion/Jev assessment path as a semantic match. This is a stronger framing than a separate grep system activated only after semantic failure.

Our lexical service already has on-demand token/path/text scoring. The current optional fallback runs when there are no vector candidates, not when reranked candidates fail the answer threshold, and its results are not assessed as semantic evidence. Reuse or adapt that machinery before adding another index or subprocess subsystem. [J5]

Keep lookup origin separate from evidence strength: lexical discovery can find excellent evidence; semantic similarity can find irrelevant evidence. Neither score alone proves usefulness. A literal mention is not a verified code reference.

## 4. Retrieval relationships are not validity dependencies

Locus explicitly distinguishes “where should we look next?” from “which inputs must remain valid for this artifact to be reused?” Its incremental design records source inputs, configuration, tool/model versions, and relevant search scopes, including unsuccessful lookups. [D3, D5]

Example across both source types:

- “This is the only caller” becomes invalid when another caller is added, even if the cited function is unchanged.
- “This is the only refund exception” becomes invalid when a new exception section is added, even if the cited paragraph is unchanged.

**Transfer now:** preserve derivation inputs and avoid exhaustive claims from bounded retrieval. Do not use same-file/reference pointers as an implicit cache-invalidation graph. Our reranker already checks current source hashes and fingerprints the full assessment request; retain those safeguards. [J4]

**Defer:** persistent revision trees, fine-grained incremental dependency execution, and source lineage. They may matter when repeated indexing or derived-context regeneration becomes demonstrably expensive, but the inspected prototype does not validate their benefits.

## 5. Return bounded evidence, not an implied final answer

Locus's approved context contract separates execution outcome, response truncation, and evidence coverage. A completed request can omit discovered results due to budget; an untruncated response can still leave unsupported or unprocessed source areas. It distinguishes direct observations, generated explanations, and inferred relationships. [D4]

**Transfer:** give the consumer relevant source-backed context and make limitations explicit. A Jev relevance score is not proof of corpus completeness, source truth, or an established root cause.

The current search report already has evidence states and diagnostic findings. More explicit coverage/budget metadata would be an extension, not a reason to replace its pipeline. Avoid silently equating `supported` with an exhaustive answer. [J6]

Likewise, “references” should retain their basis: resolved code binding, explicit document link, or a literal textual mention are not interchangeable evidence kinds. [D3, D4]

## 6. History is a later hint, not current source evidence

Locus separates historical investigation episodes from conditional resource guidance and from current source facts. History may influence discovery priorities but must not permanently suppress evidence or make old claims current. [D2, D8]

**Potential later value:** recurring misses could suggest useful navigation paths. Initially, turn real misses into regression cases rather than building a feedback-memory subsystem. Jev does not remove the applicability, attribution, retention, or confirmation-bias problems of persistent guidance.

## What Jev changes—and what it does not

Our current code already uses Jev for typed relevance assessment of primary and supporting evidence. This supplies a decision mechanism for judging the usefulness of structural or lexical candidates. It does not recover candidates that discovery never found. Nor does it establish exact boundaries, reference resolution, freshness, permissions, or exhaustive coverage; those remain deterministic contracts or explicit limitations. [J3–J5]

Useful division of responsibility:

> Extractors identify structure and explicit links; search finds candidates; bounded traversal proposes more evidence; Jev assesses relevance; source validation establishes currency; the consumer performs final task reasoning.

This is a candidate boundary, not a requirement to add six services.

## Recommendation for discussion

Highest-value ideas to retain:

1. Source-neutral units and typed relationships, independently of AST extraction.
2. Anchors and semantic discovery entering one bounded context-retrieval path.
3. A strict distinction between source facts, relevance judgments, and coverage limits.
4. Validity-aware reuse as a principle, without adopting the full incremental engine now.

Defer graph diffusion, generated community summaries, persistent revision trees, cross-revision lineage, and feedback learning until concrete failures justify them. Most of the immediate value is clearer boundaries around code we already have, not additional infrastructure.

A useful later comparison would hold the query/model/budget fixed across flat retrieval, current expansion, section-aware general expansion, and lexical-plus-semantic seeds. Use mixed prose/code fixtures, section boundaries, misleading neighbors, exact literals, and evidence requiring a bridge chunk. Measure relevant evidence recovered, unsupported inclusions, source correctness, latency, and total inference work. No such experiment was run or approved in this review.

## Sources inspected

### Deepwell / Locus primary project artifacts

- **D1:** [`../deepwell/README.md`](../../../deepwell/README.md), [`index.ts`](../../../deepwell/index.ts), and [`package.json`](../../../deepwell/package.json).
- **D2:** [`../deepwell/CONTEXT.md`](../../../deepwell/CONTEXT.md).
- **D3:** [Locus GraphRAG design/research note](../../../deepwell/docs/research/graphrag-and-relationship-centric-retrieval.md), especially sections 1, 5–9. Used as evidence of Locus's reasoning; its external literature claims were not independently re-researched here.
- **D4:** [Issue 6 approved context contract](https://github.com/cloakedj/Locus/issues/6#issuecomment-5552855880).
- **D5:** [Issue 19 approved incremental semantics](https://github.com/cloakedj/Locus/issues/19#issuecomment-5554867210).
- **D6:** [Issue 26 resolution](https://github.com/cloakedj/Locus/issues/26#issuecomment-5558163741) and [report](https://github.com/cloakedj/Locus/blob/prototype/issue-26-heldout-validation/prototypes/issue-26/report.md).
- **D7:** [Issue 26 generating script](https://github.com/cloakedj/Locus/blob/prototype/issue-26-heldout-validation/prototypes/issue-26/persistent-tree-heldout-validation.ts), read completely. Scenario fields and `summarize()` expose the hard-coded-results limitation. Branch links are mutable.
- **D8:** [Feedback-history research note](../../../deepwell/docs/research/feedback-memory-and-procedural-learning.md) and [issue 21 requirements](https://github.com/cloakedj/Locus/issues/21).

Also inspected Locus's competing-systems, novelty/prior-art, and Graphify-overlap notes, issue-list bodies, and issue-25 discussion. These provide background, not independently verified competitor claims or runtime evidence.

### Current project source

- **J1:** [`src/inventory/types.ts`](../../src/inventory/types.ts) and [`syntax/types.ts`](../../src/inventory/syntax/types.ts).
- **J2:** [`src/inventory/reader.ts`](../../src/inventory/reader.ts).
- **J3:** [`src/retrieval/context/utils.ts`](../../src/retrieval/context/utils.ts).
- **J4:** [`src/retrieval/reranking/index.ts`](../../src/retrieval/reranking/index.ts).
- **J5:** [`src/retrieval/index.ts`](../../src/retrieval/index.ts) and [`src/lexical/index.ts`](../../src/lexical/index.ts).
- **J6:** [`src/retrieval/types.ts`](../../src/retrieval/types.ts) and [`CONTEXT.md`](../../CONTEXT.md).

Current-project comparisons refer to the inspected working tree, which already contains uncommitted implementation changes. This review does not approve or overwrite those changes.
