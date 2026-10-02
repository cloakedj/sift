import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { agentSearchReport } from "../src/messages/search/utils.js";
import { AGENT_PREVIEW_CHARACTERS } from "../src/messages/search/consts.js";
import type { SearchReport, SearchResult } from "../src/retrieval/types.js";
import { DocumentChunker } from "../src/inventory/document/index.js";
import { SyntaxChunker } from "../src/inventory/syntax/index.js";

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
    shortlist: { strategy: "diversified", poolCandidates: 32, lexicalPoolLimit: 32 },
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
  assert.equal(output.schemaVersion, 2);
  assert.equal(result.preview, `10 | ${"x".repeat(AGENT_PREVIEW_CHARACTERS)}`);
  assert.deepEqual(result.previewRange, {
    startLine: 10,
    endLine: 10,
    startByte: 100,
    endByte: 100 + AGENT_PREVIEW_CHARACTERS,
  });
  assert.equal(result.startByte, 100);
  assert.equal(result.endByte, 9000);
  assert.equal(result.previewTruncated, true);
  assert.equal(result.previewClippedMidLine, true);
  assert.equal(result.relevance, 0.9);
  assert.equal(result.context?.[0]?.previewTruncated, false);
  assert.equal(result.context?.[0]?.relation, "reference");
  assert.deepEqual(output.shortlist, input.shortlist);
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

test("numbered previews preserve original line endings without a phantom trailing line", () => {
  for (const [text, expected, endLine] of [
    ["first\n\nthird\n", "10 | first\n11 | \n12 | third\n", 12],
    ["first\r\n\r\n界😀", "10 | first\r\n11 | \r\n12 | 界😀", 12],
    ["\n", "10 | \n", 10],
    ["last fragment", "10 | last fragment", 10],
  ] as const) {
    const input = report();
    input.results[0]!.record.resource.textPreview = text;
    const result = agentSearchReport(input).results[0]!;
    assert.equal(result.preview, expected);
    assert.equal(result.previewTruncated, false);
    assert.equal(result.previewClippedMidLine, false);
    assert.deepEqual(result.previewRange, {
      startLine: 10,
      endLine,
      startByte: 100,
      endByte: 100 + Buffer.byteLength(text),
    });
    assert.equal(result.endLine, 90, "full chunk range is independent of the displayed range");
  }
});

test("clipping preserves Unicode and CRLF boundaries and marks mid-line cuts", () => {
  const prefix = "x".repeat(AGENT_PREVIEW_CHARACTERS - 1);
  for (const suffix of ["😀tail", "\r\ntail"]) {
    const input = report();
    input.results[0]!.record.resource.textPreview = prefix + suffix;
    const result = agentSearchReport(input).results[0]!;
    assert.equal(result.preview, `10 | ${prefix}`);
    assert.equal(result.previewRange?.endByte, 100 + prefix.length);
    assert.equal(result.previewTruncated, true);
    assert.equal(result.previewClippedMidLine, true);
    assert.doesNotMatch(result.preview, /[\uD800-\uDFFF]/u);
  }
  const input = report();
  input.results[0]!.record.resource.textPreview = prefix + "\nnext line";
  const result = agentSearchReport(input).results[0]!;
  assert.equal(result.preview, `10 | ${prefix}\n`);
  assert.equal(result.previewRange?.endLine, 10);
  assert.equal(result.previewClippedMidLine, false);
  assert.equal(result.previewTruncated, true);
});

test("exact-budget and empty excerpts do not claim clipping or invent source lines", () => {
  const input = report();
  input.results[0]!.record.resource.textPreview = "界".repeat(AGENT_PREVIEW_CHARACTERS);
  let result = agentSearchReport(input).results[0]!;
  assert.equal(result.previewTruncated, false);
  assert.equal(result.previewRange?.endByte, 100 + AGENT_PREVIEW_CHARACTERS * 3);
  input.results[0]!.record.resource.textPreview = "";
  result = agentSearchReport(input).results[0]!;
  assert.equal(result.preview, "");
  assert.equal(result.previewRange, null);
  assert.equal(result.previewTruncated, false);
  assert.equal(result.previewClippedMidLine, false);
});

test("displayed byte and line ranges address actual document and syntax source fragments", () => {
  const samples = [
    {
      path: "notes.md",
      text: "# Heading\r\n\r\n" + "界😀".repeat(4000) + "\r\n\r\nEnd.\r\n",
      chunker: new DocumentChunker(),
    },
    {
      path: "code.ts",
      text: "// header\r\nexport class Example {\r\n  public run() { return '界😀'; }\r\n}\r\n",
      chunker: new SyntaxChunker(),
    },
  ];
  for (const { path, text, chunker } of samples) {
    const bytes = Buffer.from(text);
    const chunks = chunker.chunk(text, path, "resource");
    assert.ok(chunks?.length);
    for (const chunk of chunks) {
      const input = report();
      input.results[0]!.record.resource.textPreview = chunk.text;
      input.results[0]!.record.resource.range = {
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        startByte: chunk.startByte,
        endByte: chunk.endByte,
      };
      const result = agentSearchReport(input).results[0]!;
      const range = result.previewRange!;
      const original = bytes.subarray(range.startByte, range.endByte).toString("utf8");
      assert.equal(result.preview.replace(/^\d+ \| /gm, ""), original);
      assert.equal(
        range.startLine,
        bytes.subarray(0, range.startByte).toString().split("\n").length,
      );
      const lastByteLine = bytes
        .subarray(0, range.endByte - 1)
        .toString()
        .split("\n").length;
      assert.equal(range.endLine, lastByteLine);
      assert.ok(range.endByte <= chunk.endByte);
      assert.ok(original.length <= AGENT_PREVIEW_CHARACTERS);
      assert.ok(!original.includes("�"));
      const lineNumbers = [...result.preview.matchAll(/^(\d+) \| /gm)].map((match) =>
        Number(match[1]),
      );
      assert.deepEqual(
        lineNumbers,
        Array.from({ length: range.endLine - range.startLine + 1 }, (_, i) => range.startLine + i),
      );
    }
  }
});

test("numbering does not merge repeated primary/context evidence or promote diagnostics", () => {
  const input = report();
  const shared = hit("shared");
  shared.record.resource.textPreview = "export const FILE = 'index.json';";
  shared.relevance!.score = 0.4;
  input.results[0]!.primaryRelevance = { ...input.results[0]!.relevance!, score: 0.6 };
  input.results[0]!.context = [
    { record: shared.record, relation: "reference", basis: "indexed-import" },
  ];
  input.candidates = [input.results[0]!, shared];
  const output = agentSearchReport(input);
  assert.equal(output.results.length, 1);
  assert.equal(output.candidates?.length, 2);
  assert.equal(output.results[0]?.primaryRelevance, 0.6);
  const context = output.results[0]!.context![0]!;
  assert.equal(context.preview, output.candidates![1]!.preview);
  assert.deepEqual(context.previewRange, output.candidates![1]!.previewRange);
  assert.equal(context.relation, "reference");
  assert.equal(context.basis, "indexed-import");
  assert.equal(output.candidates![1]!.relevance, 0.4);
  assert.equal(output.results[0]!.relevance, 0.9);
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
