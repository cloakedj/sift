import assert from "node:assert/strict";
import { test } from "node:test";
import { retrievalDiagnostics } from "../src/retrieval/diagnostics/utils.js";
import type { DiagnosticInput, PrimaryOutcome } from "../src/retrieval/diagnostics/types.js";
import type { SearchResult } from "../src/retrieval/types.js";
import type { SemanticChunkRecord } from "../src/onboarding/types.js";

function record(id: string): SemanticChunkRecord {
  return {
    schemaVersion: 1,
    id,
    resource: {
      id: "file",
      uri: "file:///source.md",
      mediaType: "text/markdown",
      range: { startLine: 1, endLine: 1, startByte: 0, endByte: 4 },
      resourceHash: "source-hash",
      chunkHash: id,
      textPreview: "text",
      structure: { mode: "document", related: [] },
    },
    taxonomy: {
      domains: [],
      concepts: [],
      operations: [],
      dependencies: [],
      risks: [],
      evidenceKinds: [],
    },
    embeddingDocument: "colliding embedding document",
    classificationFingerprint: "classification",
    provenance: {
      runId: "run",
      model: "test",
      questionSetId: "test",
      taxonomyRegistryVersion: "test",
      chunkerVersion: "test",
      projectionVersion: "test",
      receiptIds: [],
    },
  };
}
function hit(record: SemanticChunkRecord, score = 0.9): SearchResult {
  return {
    rank: 1,
    score: 1,
    vectorId: record.id,
    record,
    relevance: {
      score,
      confidence: 1,
      probabilities: {},
      model: "test",
      fingerprint: record.id,
      questionSetVersion: "test",
    },
  };
}
function input(): DiagnosticInput {
  const source = record("target");
  const candidate = hit(source);
  return {
    traceChunks: [source.id],
    records: [source],
    discovery: [{ id: source.id, lexicalRank: 1, inPool: true, shortlisted: true }],
    primary: [candidate],
    context: [],
    final: [candidate],
    returned: [candidate],
    rerank: true,
    minRelevance: 0.75,
    assessments: [],
  };
}

test("target traces separate all known primary pipeline losses", () => {
  const cases: [PrimaryOutcome, (value: DiagnosticInput) => void][] = [
    [
      "not-in-publication",
      (value) => {
        value.records = [];
      },
    ],
    [
      "not-discovered",
      (value) => {
        value.discovery = [];
      },
    ],
    [
      "outside-merge-pool",
      (value) => {
        value.discovery[0]!.inPool = false;
        value.discovery[0]!.shortlisted = false;
      },
    ],
    [
      "outside-shortlist",
      (value) => {
        value.discovery[0]!.shortlisted = false;
      },
    ],
    [
      "unassessed",
      (value) => {
        value.rerank = false;
        delete value.primary[0]!.relevance;
      },
    ],
    [
      "rejected",
      (value) => {
        value.final = [hit(value.records[0]!, 0.2)];
        value.returned = [];
      },
    ],
    [
      "omitted-by-top-k",
      (value) => {
        value.returned = [];
      },
    ],
    ["returned", () => {}],
  ];
  for (const [outcome, change] of cases) {
    const value = input();
    change(value);
    const before = JSON.stringify(value);
    const result = retrievalDiagnostics(value).targets[0]!;
    assert.equal(result.primaryOutcome, outcome);
    assert.equal(result.published, outcome !== "not-in-publication");
    assert.equal(JSON.stringify(value), before);
  }
});

test("context eligibility, rejected standalone relevance, selection and delivery remain distinct", () => {
  const value = input();
  const source = value.records[0]!;
  const seed = record("seed");
  seed.resource.structure!.related = [
    { id: source.id, relation: "reference", basis: "explicit-link" },
  ];
  value.records.push(seed);
  value.primary = [hit(seed), hit(source, 0.1)];
  value.context = [hit(source, 0.55)];
  value.final = [
    {
      ...hit(seed, 0.99),
      primaryRelevance: value.primary[0]!.relevance,
      context: [{ record: source, relation: "reference", basis: "explicit-link" }],
    },
    hit(source, 0.1),
  ];
  value.returned = [];
  let result = retrievalDiagnostics(value).targets[0]!;
  assert.deepEqual(result.context.eligibleFor, [seed.id]);
  assert.equal(result.context.assessed, true);
  assert.equal(result.context.judgment?.score, 0.55);
  assert.equal(result.primaryJudgment?.score, 0.1);
  assert.deepEqual(result.context.selectedFor, [seed.id]);
  assert.deepEqual(result.context.returnedFor, []);
  assert.equal(result.primaryOutcome, "rejected");
  value.returned = [value.final[0]!];
  result = retrievalDiagnostics(value).targets[0]!;
  assert.deepEqual(result.context.returnedFor, [seed.id]);
  assert.equal(
    result.returned,
    false,
    "context delivery does not promote the target to primary evidence",
  );
  value.context = [];
  value.final = [];
  value.returned = [];
  result = retrievalDiagnostics(value).targets[0]!;
  assert.equal(result.context.assessed, false);
  assert.deepEqual(
    result.context.eligibleFor,
    [seed.id],
    "an eligible link may miss the bounded context pool",
  );
});

test("exact embedding collisions retain a bounded peer list and distinguish unknown IDs", () => {
  const value = input();
  value.records.push(...Array.from({ length: 10 }, (_, index) => record(`peer-${index}`)));
  value.traceChunks = ["target", "missing"];
  const output = retrievalDiagnostics(value);
  const embedding = output.targets[0]!.embedding!;
  assert.equal(embedding.document, "colliding embedding document");
  assert.match(embedding.documentHash, /^[a-f0-9]{64}$/);
  assert.equal(embedding.collisionGroupSize, 11);
  assert.equal(embedding.collidingChunkIds.length, 8);
  assert.equal(embedding.omittedCollidingChunks, 2);
  assert.equal(output.targets[1]!.embedding, undefined);
  assert.equal(output.targets[1]!.source, undefined);
  assert.equal(output.targets[1]!.published, false);
});
