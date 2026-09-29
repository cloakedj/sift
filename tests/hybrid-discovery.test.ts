import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverCandidates } from "../src/retrieval/discovery/utils.js";
import { contextCandidates } from "../src/retrieval/context/utils.js";
import { DocumentChunker } from "../src/inventory/document/index.js";
import { linkStructure } from "../src/inventory/structure/utils.js";
import type { SemanticChunkRecord } from "../src/onboarding/types.js";
import type { SearchResult } from "../src/retrieval/types.js";

function record(id: string, text: string): SemanticChunkRecord {
  return {
    schemaVersion: 1,
    id,
    resource: {
      id,
      uri: `file:///${id}.txt`,
      range: { startByte: 0, endByte: Buffer.byteLength(text), startLine: 1, endLine: 1 },
      mediaType: "text/plain",
      resourceHash: id,
      chunkHash: id,
      textPreview: text,
    },
    taxonomy: {
      domains: [],
      concepts: [],
      operations: [],
      dependencies: [],
      risks: [],
      evidenceKinds: [],
    },
    embeddingDocument: text,
    classificationFingerprint: id,
    provenance: {
      runId: "test",
      model: "test",
      questionSetId: "test",
      taxonomyRegistryVersion: "test",
      chunkerVersion: "structure-v3",
      projectionVersion: "v4",
      receiptIds: [],
    },
  };
}
function hit(record: SemanticChunkRecord, score = 0.9): SearchResult {
  return { record, rank: 1, score, source: "semantic", vectorId: record.id };
}

test("lexical seeds recover literal and Unicode matches absent from semantic results without another index", () => {
  const semantic = record("payments", "Cards accepted.");
  const exact = record("refunds", "Use ERR_REFUND_WINDOW for expired requests.");
  const unicode = record("overseas", "海外払い戻し");
  const records = [semantic, exact, unicode];
  const result = discoverCandidates("ERR_REFUND_WINDOW", records, [hit(semantic)], 8);
  assert.equal(result.discovered, 2);
  assert.ok(
    result.results.some((item) => item.record.id === exact.id && item.source === "lexical"),
  );
  assert.ok(result.results.every((item) => item.relevance === undefined));
  assert.equal(
    discoverCandidates("海外払い戻し", records, [], 8).results[0]!.record.id,
    unicode.id,
  );
  assert.equal(discoverCandidates("not_present_anywhere", records, [], 8).results.length, 0);
});

test("deduplicated candidates retain lookup origins, never sum incompatible raw scores", () => {
  const exact = record("exact", "ERR_REFUND_WINDOW");
  const other = record("other", "Unrelated");
  const low = discoverCandidates(
    "ERR_REFUND_WINDOW",
    [exact, other],
    [hit(exact, 0.1), hit(other, 0.01)],
    8,
  );
  const high = discoverCandidates(
    "ERR_REFUND_WINDOW",
    [exact, other],
    [hit(exact, 999), hit(other, 888)],
    8,
  );
  assert.deepEqual(
    low.results.map((item) => item.score),
    high.results.map((item) => item.score),
  );
  assert.equal(low.results[0]!.source, "hybrid");
  assert.deepEqual(
    low.results[0]!.discovery!.map((signal) => signal.source),
    ["semantic", "lexical"],
  );
  assert.equal(low.results.filter((item) => item.record.id === exact.id).length, 1);
});

test("exact literal and location anchors have priority but do not exclude other candidates", () => {
  const a = record("a", "Context");
  const b = record("b", "Use X here");
  const result = discoverCandidates("Context", [a, b], [hit(a)], 8, [
    { kind: "literal", value: "X" },
  ]);
  assert.equal(result.anchorMatches, 1);
  assert.equal(result.results[0]!.record.id, b.id);
  assert.equal(result.results[0]!.source, "anchor");
  assert.ok(result.results.some((item) => item.record.id === a.id));
  assert.equal(
    discoverCandidates("missing", [a, b], [], 8, [{ kind: "literal", value: "x" }]).anchorMatches,
    1,
  ); // "Context" contains lower-case x; literals preserve case.
  const location = discoverCandidates("Context", [a, b], [], 8, [
    { kind: "location", uri: b.resource.uri, line: 1 },
  ]);
  assert.equal(location.results[0]!.record.id, b.id);
  assert.equal(
    discoverCandidates("missing", [a, b], [], 8, [
      { kind: "location", uri: b.resource.uri, line: 2 },
    ]).anchorMatches,
    0,
  );
});

test("known omitted discovery candidates are counted separately from returned-result budgets", () => {
  const records = Array.from({ length: 20 }, (_, index) =>
    record(`r${index}`, "ERR_REFUND_WINDOW"),
  );
  const result = discoverCandidates("ERR_REFUND_WINDOW", records, [], 8);
  assert.equal(result.results.length, 8);
  assert.equal(result.discovered, 20);
  assert.equal(result.omitted, 12);
  const anchored = discoverCandidates("missing", records, [], 8, [
    { kind: "literal", value: "ERR_REFUND_WINDOW" },
  ]);
  assert.equal(anchored.anchorMatches, 20);
  assert.equal(anchored.omitted, 12);
});

test("document expansion follows extracted relationships, not arbitrary same-file proximity", () => {
  const chunks = new DocumentChunker().chunk(
    "# Refunds\n\nUse ERR_REFUND_WINDOW.\n\n# Payments\n\nCards only.\n",
    "policy.md",
    "policy",
  );
  linkStructure(chunks);
  const records = chunks.map((chunk) => ({
    ...record(chunk.id, chunk.text),
    resource: {
      ...record(chunk.id, chunk.text).resource,
      id: "policy",
      range: {
        startByte: chunk.startByte,
        endByte: chunk.endByte,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
      },
      structure: chunk.structure,
    },
  }));
  const seed = hit(records.find((item) => item.resource.textPreview.startsWith("Use ERR"))!);
  seed.relevance = {
    score: 1,
    confidence: 1,
    probabilities: {},
    fingerprint: "test",
    model: "test",
    questionSetVersion: "test",
  };
  const pool = contextCandidates([seed], records);
  assert.ok(pool.some((item) => item.record.resource.textPreview.startsWith("# Refunds")));
  assert.ok(!pool.some((item) => item.record.resource.structure?.label === "Payments"));
});
