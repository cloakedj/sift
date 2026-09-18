# Decide semantic record schema

Labels: wayfinder:grilling
Parent: Fast Semantic Search Engine on Jev
Status: closed
Assignee: cloakedj
Blocked by: Research Jev capabilities for embeddings and structured scoring

## Question

What structured meaning should onboarding ask Jev to produce for each code chunk? Decide the durable semantic record schema: purpose, concepts, operations, domain, dependencies, risks, natural-language aliases, confidence, score dimensions, raw source references, and versioning.

## Checkpoint unlocked

`onboard` can persist a stable semantic record per chunk that future search, embedding, scoring, and Vectorize sync can depend on.

## Resolution

Use a generalized, resource-oriented semantic chunk record. The MVP is hybrid: local onboarding supplies stable resource/chunk facts and universal candidate harvesting; Jev supplies typed classification/scoring/governance over taxonomies. No generated prose is required in the MVP, though a later layer may turn Jev responses into LLM-style summaries/messages.

Approved schema shape:

```ts
interface SemanticChunkRecord {
  schemaVersion: 1;
  id: string;

  resource: {
    id: string;
    uri: string;
    mediaType: string;
    language?: string;
    range: {
      startLine?: number;
      endLine?: number;
      startByte?: number;
      endByte?: number;
    };
    resourceHash: string;
    chunkHash: string;
    textPreview: string;
  };

  taxonomy: {
    resourceKind?: LabelScore;
    domains: LabelScore[];
    concepts: LabelScore[];
    operations: LabelScore[];
    dependencies: LabelScore[];
    risks: LabelScore[];
    evidenceKinds: LabelScore[];
  };

  embeddingDocument: string;
  pluginFacets?: Record<string, unknown>;

  provenance: {
    runId: string;
    questionSetId: string;
    taxonomyRegistryVersion: string;
    receiptIds?: string[];
  };
}

interface LabelScore {
  labelId: string;
  nameSnapshot: string;
  score: number;
  confidence?: number;
  probabilities?: Record<string, number>;
}
```

Decisions:

- Optimize first against missed relevant chunks, while preserving explainability and Vectorize portability.
- Core MVP extraction is generic and language-light: resource URI/path, media type, ranges, hashes, raw chunk text, and universal candidate harvesting. AST/language-specific extraction can be added later through plugins.
- Taxonomy comes from built-in labels, project/source config, plugin-provided labels, and discovered candidates.
- Taxonomy mutation is automatic but soft: Jev-governed additions/promotions are applied; merges/deprecations/replacements are represented reversibly until later confidence justifies fully automated destructive compaction.
- Semantic records reference taxonomy labels by stable ID and include label name snapshots for debugging and embedding.
- `embeddingDocument` is a deterministic, human-readable projection of selected resource and taxonomy fields with stable field ordering, so local embeddings and Vectorize receive the same semantic input.
- Use `resourceHash` and `chunkHash` in the schema. First implementation may reclassify per chunk hash; Merkle-style resource/index hashing can come later.
- Plugin facets are allowed but must not complicate the proof of concept. Core search depends on the core fields, not plugins.
- Onboarding receipts are append-only historical receipts with a small stable envelope (`subject`) and flexible `action`. They are useful for audit/debug/training and may later be embedded, but search must not depend on them.

New follow-up ticket: [Research universal taxonomy candidate harvesting](10-research-universal-taxonomy-candidate-harvesting.md).
