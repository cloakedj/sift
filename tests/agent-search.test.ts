import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { agentSearchReport } from "../src/messages/search/utils.js";
import { AGENT_PREVIEW_CHARACTERS } from "../src/messages/search/consts.js";
import type { SearchReport, SearchResult } from "../src/retrieval/types.js";

function hit(id: string): SearchResult {
  return {
    rank: 1,
    score: 0.5,
    vectorId: id,
    source: "hybrid",
    record: {
      id,
      resource: {
        id: "file",
        uri: "file:///repo/source%20file.ts",
        mediaType: "text/typescript",
        resourceHash: "hash",
        chunkHash: id,
        range: { startLine: 10, endLine: 90, startByte: 100, endByte: 9000 },
        textPreview: "x".repeat(3000),
        structure: { mode: "syntax", symbol: "Service.run", references: [], related: [] },
      },
      taxonomy: {
        domains: [],
        concepts: [],
        operations: [],
        dependencies: [],
        risks: [],
        evidenceKinds: [],
      },
      provenance: {
        runId: "run",
        model: "test",
        chunkerVersion: "test",
        projectionVersion: "test",
        taxonomyRegistryVersion: "test",
        questionSetId: "test",
        receiptIds: [],
      },
    },
    relevance: {
      score: 0.9,
      confidence: 0.8,
      probabilities: {},
      model: "test",
      fingerprint: "fp",
      questionSetVersion: "test",
    },
  };
}

function report(): SearchReport {
  return {
    schemaVersion: 1,
    root: "/repo",
    query: "How does this work?",
    reusedIntent: false,
    ranking: "jev-relevance",
    execution: "complete",
    evidence: { state: "supported", threshold: 0.75, considered: 8 },
    coverage: {
      scope: "active-publication",
      exhaustive: false,
      totalChunks: 40,
      discoveredPrimaryCandidates: 20,
      assessedPrimaryCandidates: 8,
      boundedChunks: 0,
      anchorMatches: 0,
      limitations: ["bounded-discovery"],
    },
    truncation: { results: true, omittedResults: 2, candidates: true, omittedCandidates: 12 },
    publication: {
      fingerprint: "fp",
      namespace: "namespace",
      verifiedAt: "now",
      embeddingSpace: {
        provider: "cloudflare-workers-ai",
        model: "@cf/baai/bge-base-en-v1.5",
        dimensions: 768,
        pooling: "cls",
        metric: "cosine",
      },
      vectorBackend: {
        provider: "cloudflare-vectorize",
        index: "test",
        accountId: "private-account",
      },
    },
    results: [hit("accepted")],
    findings: [{ severity: "warning", message: "Bounded coverage, not exhaustive." }],
    timings: [],
  };
}

test("agent projection preserves citations, supporting context and coverage without rich metadata", () => {
  const input = report();
  const context = hit("context").record;
  context.resource.textPreview = "short source";
  input.results[0]!.context = [{ record: context, relation: "reference", basis: "bound-symbol" }];
  const before = JSON.stringify(input);
  const output = agentSearchReport(input);
  const result = output.results[0]!;
  assert.equal(result.path, "/repo/source file.ts");
  assert.equal(result.startLine, 10);
  assert.equal(result.endLine, 90);
  assert.equal(result.symbol, "Service.run");
  assert.equal(result.preview.length, AGENT_PREVIEW_CHARACTERS);
  assert.equal(result.previewTruncated, true);
  assert.equal(result.relevance, 0.9);
  assert.equal(result.context?.[0]?.previewTruncated, false);
  assert.equal(result.context?.[0]?.relation, "reference");
  assert.deepEqual(output.coverage, input.coverage);
  assert.deepEqual(output.truncation, input.truncation);
  assert.deepEqual(output.evidence, input.evidence);
  assert.deepEqual(output.findings, input.findings);
  assert.doesNotMatch(JSON.stringify(output), /taxonomy|provenance|private-account|vectorId/);
  assert.equal(JSON.stringify(input), before);
  assert.ok(JSON.stringify(output).length < before.length);
});

test("agent explain retains candidate order separately from accepted results", () => {
  const input = report();
  input.results = [];
  input.evidence = { state: "insufficient", threshold: 0.75, considered: 2 };
  input.candidates = [hit("rejected-a"), { ...hit("rejected-b"), rank: 2 }];
  input.judgments = { reused: 2, new: 0 };
  const output = agentSearchReport(input);
  assert.deepEqual(output.results, []);
  assert.equal(output.evidence?.state, "insufficient");
  assert.deepEqual(
    output.candidates?.map((item) => item.id),
    ["rejected-a", "rejected-b"],
  );
  assert.deepEqual(output.judgments, input.judgments);
});

test("agent projection does not promote unassessed results or combine distinct chunks", () => {
  const input = report();
  input.ranking = "hybrid";
  input.evidence = { state: "not-assessed", considered: 2 };
  input.results = [hit("one"), { ...hit("two"), rank: 2 }];
  for (const result of input.results) delete result.relevance;
  const output = agentSearchReport(input);
  assert.equal(output.evidence?.state, "not-assessed");
  assert.equal(output.results.length, 2);
  assert.equal(output.results[0]?.relevance, undefined);
  assert.equal(output.candidates, undefined);
});

test("CLI rejects agent mode without JSON or with intent-only before provider work", () => {
  for (const args of [["--agent"], ["--agent", "--json", "--show-intent"]]) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli/index.ts", "search", "question", ...args],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          TYPESAFE_API_KEY: "",
          CLOUDFLARE_API_TOKEN: "",
          CLOUDFLARE_ACCOUNT_ID: "",
        },
      },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /INVALID_ARGUMENT/);
    assert.match(result.stderr, /--agent requires/);
  }
});
