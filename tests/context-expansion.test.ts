import assert from "node:assert/strict";
import { test } from "node:test";
import { contextCandidates, expandContext } from "../src/retrieval/context/utils.js";
import type { SemanticChunkRecord } from "../src/onboarding/types.js";
import type { SearchResult } from "../src/retrieval/types.js";
import { orderEvidence } from "../src/retrieval/utils.js";

function record(id: string, file: string, related: string[] = []): SemanticChunkRecord {
  return {
    schemaVersion: 1,
    id,
    resource: {
      id: file,
      uri: `file:///${file}`,
      resourceHash: file,
      chunkHash: id,
      textPreview: id,
      mediaType: "text/typescript",
      range: { startByte: 0, endByte: 20, startLine: 1, endLine: 1 },
      structure: {
        mode: "syntax",
        references: [],
        related: related.map((target) => ({
          id: target,
          relation: "reference",
          basis: "bound-symbol",
        })),
      },
    },
    taxonomy: {
      domains: [],
      concepts: [],
      operations: [],
      dependencies: [],
      risks: [],
      evidenceKinds: [],
    },
    embeddingDocument: id,
    classificationFingerprint: id,
    provenance: {
      runId: "run",
      model: "test",
      chunkerVersion: "structure-v3",
      projectionVersion: "v3",
      taxonomyRegistryVersion: "tax",
      questionSetId: "q",
      receiptIds: [],
    },
  };
}
function hit(record: SemanticChunkRecord, score: number): SearchResult {
  return {
    rank: 1,
    score: 0.8,
    vectorId: record.id,
    record,
    relevance: {
      score,
      confidence: 1,
      probabilities: {},
      fingerprint: record.id,
      model: "test",
      questionSetVersion: "test",
    },
  };
}

test("one-hop context stays in publication, deduplicates cycles, and judges relatedness separately", () => {
  const primary = record("search", "index.ts", ["limit", "helper", "deleted"]);
  const limit = record("limit", "consts.ts", ["search", "second-hop"]);
  const helper = record("helper", "utils.ts");
  const secondHop = record("second-hop", "other.ts");
  const neighbor = record("nearby", "index.ts");
  const records = [primary, limit, helper, secondHop, neighbor];
  const hits = [hit(primary, 0.65)];
  const pool = contextCandidates(hits, records);
  assert.deepEqual(
    pool.map((item) => item.record.id),
    ["limit", "helper"],
  );
  const expanded = expandContext(hits, records, [
    hit(limit, 0.9),
    hit(helper, 0.05),
    hit(neighbor, 0.1),
  ]);
  assert.deepEqual(
    expanded[0]!.context?.map((item) => [item.record.id, item.relation]),
    [["limit", "reference"]],
  );
  assert.equal(hits[0]!.context, undefined);
  assert.equal(contextCandidates([hit(primary, 0.1)], records).length, 0);
  assert.equal(expandContext(hits, records, [])[0]!.context, undefined);
});

test("direct evidence precedes a caller that answers only through context", () => {
  const direct = hit(record("implementation", "utils.ts"), 0.98);
  const caller = {
    ...hit(record("caller", "index.ts"), 1),
    primaryRelevance: hit(record("caller", "index.ts"), 0.5).relevance,
  };
  const ordered = orderEvidence([caller, direct], 0.75);
  assert.equal(ordered[0]!.record.id, "implementation");
  assert.deepEqual(
    ordered.map((item) => item.rank),
    [1, 2],
  );
});

test("context pool, selected context and seed counts are bounded", () => {
  const related = Array.from({ length: 20 }, (_, i) => record(`r${i}`, `f${i}.ts`));
  const primary = record(
    "primary",
    "index.ts",
    related.map((item) => item.id),
  );
  const records = [primary, ...related];
  const pool = contextCandidates([hit(primary, 1)], records);
  assert.equal(pool.length, 8);
  const expanded = expandContext(
    [hit(primary, 1)],
    records,
    related.map((item) => hit(item, 1)),
  );
  assert.equal(expanded[0]!.context!.length, 2);
  related[0]!.resource.range.endByte = 20_000;
  const bounded = expandContext(
    [hit(primary, 1)],
    records,
    related.map((item) => hit(item, 1)),
  );
  assert.ok(bounded[0]!.context!.every((item) => item.record.id !== related[0]!.id));
});
