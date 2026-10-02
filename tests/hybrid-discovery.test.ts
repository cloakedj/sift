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

test("opt-in diversification reaches complementary files at the same primary assessment limit", () => {
  const repeated = Array.from({ length: 20 }, (_, index) => {
    const item = record(
      `dominant-${String(index).padStart(2, "0")}`,
      "repair publication governance",
    );
    item.resource.uri = "file:///history.md";
    return item;
  });
  const repair = record("repair", "publication repair prerequisite");
  const governance = record("governance", "governance decisions persist before publication");
  const records = [...repeated, repair, governance];
  const baseline = discoverCandidates("repair publication governance", records, [], 8);
  const options = { strategy: "diversified" as const };
  const diversified = discoverCandidates(
    "repair publication governance",
    records,
    [],
    8,
    [],
    options,
  );
  assert.ok(baseline.results.every((hit) => hit.record.resource.uri === "file:///history.md"));
  assert.ok(diversified.results.some((hit) => hit.record.id === repair.id));
  assert.ok(diversified.results.some((hit) => hit.record.id === governance.id));
  assert.equal(baseline.results.length, 8);
  assert.equal(diversified.results.length, 8);
  assert.equal(diversified.shortlist.lexicalPoolLimit, 32);
  assert.equal(baseline.shortlist.lexicalPoolLimit, 8);
  assert.equal(diversified.discovered, baseline.discovered);
  assert.deepEqual(
    diversified,
    discoverCandidates("repair publication governance", [...records].reverse(), [], 8, [], options),
  );
  assert.ok(diversified.results.every((hit) => hit.relevance === undefined));
});

test("diversification retains anchor priority and never hard-excludes repeated files", () => {
  const records = Array.from({ length: 12 }, (_, index) => {
    const item = record(
      `id-${String(index).padStart(2, "0")}`,
      `query ${index === 11 ? "CLUE" : ""}`,
    );
    item.resource.uri = "file:///one-file.md";
    return item;
  });
  const result = discoverCandidates("query", records, [], 8, [{ kind: "literal", value: "CLUE" }], {
    strategy: "diversified",
  });
  assert.equal(result.results.length, 8);
  assert.equal(result.results[0]!.record.id, records[11]!.id);
  assert.equal(result.results[0]!.source, "anchor");
  assert.equal(new Set(result.results.map((hit) => hit.record.id)).size, 8);
  assert.ok(
    result.results.slice(1).every((hit) => hit.record.resource.uri === "file:///one-file.md"),
  );
});

test("diversification rotates structural units within a single file before their continuations", () => {
  const chunks = new DocumentChunker().chunk(
    "# History\n\n" + "old query\n".repeat(100) + "\n# Current\n\nquery current implementation\n",
    "evolution.md",
    "file",
  );
  const records = chunks.map((chunk) => {
    const item = record(chunk.id, chunk.text);
    item.resource.uri = "file:///evolution.md";
    item.resource.structure = chunk.structure;
    return item;
  });
  const result = discoverCandidates("old query", records, [], 2, [], { strategy: "diversified" });
  assert.equal(result.results.length, 2);
  assert.ok(result.results.some((hit) => hit.record.resource.structure!.label === "Current"));
  assert.ok(result.results.some((hit) => hit.record.resource.structure!.label === "History"));
});

test("target discovery traces distinguish no hit, pre-pool and shortlist losses without changing selection", () => {
  const records = Array.from({ length: 40 }, (_, index) =>
    record(`id-${String(index).padStart(2, "0")}`, "query"),
  );
  const traces = ["absent", records[0]!.id, records[9]!.id, records[39]!.id];
  const options = { strategy: "diversified" as const, traceChunks: traces };
  const result = discoverCandidates("query", records, [], 8, [], options);
  assert.deepEqual(
    result.traces?.map(
      ({ semanticRank: _semanticRank, anchorRank: _anchorRank, ...trace }) => trace,
    ),
    [
      { id: "absent", lexicalRank: undefined, inPool: false, shortlisted: false },
      { id: records[0]!.id, lexicalRank: 1, inPool: true, shortlisted: true },
      { id: records[9]!.id, lexicalRank: 10, inPool: true, shortlisted: false },
      { id: records[39]!.id, lexicalRank: 40, inPool: false, shortlisted: false },
    ],
  );
  assert.deepEqual(
    result.results,
    discoverCandidates("query", records, [], 8, [], { strategy: "diversified" }).results,
  );
  assert.equal(result.omitted, 32);
  assert.equal(result.shortlist.poolCandidates, 32);
});

test("document expansion follows extracted relationships, not arbitrary same-file proximity", () => {
  const chunks = new DocumentChunker().chunk(
    "# Refunds\n\nRefund policy.\n\nUse ERR_REFUND_WINDOW.\n\n# Payments\n\nCards only.\n",
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
