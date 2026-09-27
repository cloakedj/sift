import assert from "node:assert/strict";
import { test } from "node:test";
import type { SemanticChunkRecord } from "../src/onboarding/types.js";
import { summarizeProjections } from "../src/onboarding/utils.js";

function record(
  id: string,
  document: string,
): Pick<SemanticChunkRecord, "id" | "resource" | "embeddingDocument"> {
  return {
    id,
    embeddingDocument: document,
    resource: {
      id: "resource",
      uri: "file:///source.md",
      mediaType: "text/markdown",
      resourceHash: "resource-hash",
      chunkHash: id,
      textPreview: "not part of the projection",
      range: { startLine: 1, endLine: 2, startByte: 0, endByte: 10 },
    },
  };
}

test("projection quality counts exact duplicate groups deterministically without exposing text", () => {
  const records = [
    record("b", "private projection A"),
    record("a", "private projection A"),
    record("c", "private projection B"),
    record("e", "private projection B"),
    record("d", "private projection C"),
  ];
  const before = structuredClone(records);
  const summary = summarizeProjections(records);
  assert.equal(summary.records, 5);
  assert.equal(summary.uniqueDocuments, 3);
  assert.equal(summary.collidingRecords, 4);
  assert.equal(summary.collisionGroups.length, 2);
  assert.deepEqual(
    summary.collisionGroups.flatMap((group) => group.chunks.map((chunk) => chunk.id)).sort(),
    ["a", "b", "c", "e"],
  );
  assert.ok(summary.collisionGroups.every((group) => /^[a-f0-9]{64}$/.test(group.documentHash)));
  assert.deepEqual(summarizeProjections([...records].reverse()), summary);
  assert.deepEqual(records, before);
  assert.ok(!JSON.stringify(summary).includes("private projection"));
  assert.deepEqual(summary.collisionGroups[0]!.chunks[0]!.range, records[0]!.resource.range);
  assert.equal(summary.collisionGroups[0]!.chunks[0]!.uri, "file:///source.md");
});

test("empty, unique, and near-identical projections are not duplicate groups", () => {
  assert.deepEqual(summarizeProjections([]), {
    records: 0,
    uniqueDocuments: 0,
    collidingRecords: 0,
    collisionGroups: [],
  });
  const summary = summarizeProjections([
    record("a", "one"),
    record("b", "one "),
    record("c", "One"),
  ]);
  assert.equal(summary.uniqueDocuments, 3);
  assert.equal(summary.collidingRecords, 0);
  assert.deepEqual(summary.collisionGroups, []);
});
