import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { Cause, Effect, Either, Exit } from "effect";
import { RelevanceRunService } from "../src/benchmark/relevance-run/index.js";
import { parseSuite, resolveLabels } from "../src/benchmark/relevance-run/utils.js";
import { AppError, Errors } from "../src/errors/index.js";
import { FileSystemService } from "../src/filesystem/index.js";
import { InventoryService } from "../src/inventory/index.js";
import type { SearchReport, SearchOptions } from "../src/retrieval/types.js";

const fs = new FileSystemService();
const inventory = new InventoryService(fs);
const suitePath = "tests/support/relevance-cases.json";
const root = resolve("tests/fixtures");
const options = { topK: 8, rerank: false, policy: "answer-if-any" as const };

function observation(corpusRoot: string, query: string, options: SearchOptions) {
  return inventory.discover(corpusRoot).pipe(
    Effect.map((items): SearchReport => ({
      schemaVersion: 1,
      root: corpusRoot,
      query,
      reusedIntent: true,
      ranking: options.rerank ? "jev-relevance" : "vector",
      publication: {
        fingerprint: "controlled-generation",
        namespace: "controlled-generation",
        embeddingSpace: {
          provider: "cloudflare-workers-ai",
          model: "controlled-model",
          dimensions: 768,
          pooling: "cls",
          metric: "cosine",
        },
        vectorBackend: {
          provider: "cloudflare-vectorize",
          accountId: "controlled-account",
          index: "controlled-index",
        },
      },
      results: items.chunks.map((chunk, index) => ({
        rank: index + 1,
        score: 0.5,
        vectorId: chunk.id,
        record: {
          id: chunk.id,
          resource: {
            id: chunk.resourceId,
            uri: items.resources.find((resource) => resource.id === chunk.resourceId)!.uri,
            mediaType: "text/plain",
            range: {
              startLine: chunk.startLine,
              endLine: chunk.endLine,
              startByte: chunk.startByte,
              endByte: chunk.endByte,
            },
            resourceHash: "controlled",
            chunkHash: chunk.chunkHash,
            textPreview: chunk.text,
          },
        },
      })),
      findings: [],
      timings: [],
    })),
  );
}

test("runner preserves every controlled observation and labels its answer baseline hypothetical", async () => {
  const calls: SearchOptions[] = [];
  const service = new RelevanceRunService(fs, inventory, {
    search: (root, query, options) => {
      calls.push(options);
      return observation(root, query, options);
    },
  });
  for (const rerank of [false, true]) {
    const report = await Effect.runPromise(service.run(suitePath, root, { ...options, rerank }));
    assert.equal(report.complete, true);
    assert.equal(report.policyKind, "hypothetical-baseline");
    assert.equal(report.outcomes.length, 12);
    assert.equal(report.metrics?.hitRateAtK, 1);
    assert.equal(report.metrics?.meanRecallAtK, 1);
    assert.equal(report.metrics?.negativeFalseAnswerRate, 1);
    assert.equal(report.metrics?.positiveAbstentionRate, 0);
    assert.match(report.suiteHash, /^[a-f0-9]{64}$/u);
    assert.ok(
      report.outcomes.every(
        (outcome) =>
          outcome.state === "succeeded" &&
          outcome.search.ranking === (rerank ? "jev-relevance" : "vector"),
      ),
    );
  }
  assert.equal(calls.length, 24);
  assert.ok(
    calls.every((call) => call.explain && call.lexicalFallback === false && call.topK === 8),
  );
});

test("threshold policy records explicit no-answer decisions without hiding retrieved distractors", async () => {
  const service = new RelevanceRunService(fs, inventory, {
    search: (root, query, options) =>
      observation(root, query, options).pipe(
        Effect.map((report) => ({
          ...report,
          results: report.results.map((result) => ({
            ...result,
            relevance: {
              score: 0.2,
              confidence: 1,
              probabilities: { unsupported: 0.8, related: 0.2, direct: 0 },
              model: "controlled-model",
              questionSetVersion: "controlled-version",
              fingerprint: `controlled-${result.record.id}`,
            },
          })),
        })),
      ),
  });
  const report = await Effect.runPromise(
    service.run(suitePath, root, {
      topK: 8,
      rerank: true,
      policy: "rerank-min-relevance",
      minRelevance: 0.5,
    }),
  );
  assert.equal(report.complete, true);
  assert.equal(report.policyKind, "explicit-threshold-experiment");
  assert.equal(report.metrics?.negativeFalseAnswerRate, 0);
  assert.equal(report.metrics?.positiveAbstentionRate, 1);
  assert.ok(
    report.outcomes.every(
      (outcome) =>
        outcome.state === "succeeded" &&
        !outcome.evaluation.answered &&
        outcome.evaluation.retrievedIds.length > 0,
    ),
  );
});

test("threshold policy requires reranking and judgments", async () => {
  const service = new RelevanceRunService(fs, inventory, {
    search: (root, query, options) => observation(root, query, options),
  });
  for (const invalid of [
    { topK: 8, rerank: false, policy: "rerank-min-relevance" as const, minRelevance: 0.5 },
    { topK: 8, rerank: true, policy: "rerank-min-relevance" as const },
    { topK: 8, rerank: true, policy: "rerank-min-relevance" as const, minRelevance: 1.1 },
  ]) {
    const result = await Effect.runPromise(Effect.either(service.run(suitePath, root, invalid)));
    assert.ok(Either.isLeft(result));
    assert.equal(result.left.code, "INVALID_ARGUMENT");
  }
  const missingJudgments = await Effect.runPromise(
    service.run(suitePath, root, {
      topK: 8,
      rerank: true,
      policy: "rerank-min-relevance",
      minRelevance: 0.5,
    }),
  );
  assert.equal(missingJudgments.complete, false);
  assert.equal(missingJudgments.outcomes[0]?.state, "failed");
});

test("runner preserves provider failures and withholds aggregate metrics", async () => {
  let calls = 0;
  const service = new RelevanceRunService(fs, inventory, {
    search: (root, query, options) => {
      calls++;
      return calls === 2
        ? Errors.fail("PROVIDER", "Controlled failure")
        : observation(root, query, options);
    },
  });
  const report = await Effect.runPromise(service.run(suitePath, root, options));
  assert.equal(calls, 12);
  assert.equal(report.complete, false);
  assert.equal(report.metrics, null);
  assert.equal(report.outcomes[1]?.state, "failed");
  assert.equal(report.outcomes.filter((outcome) => outcome.state === "succeeded").length, 11);
  assert.ok(!JSON.stringify(report).includes("stack"));
});

test("runner rejects wrong generations, foreign chunks and duplicate results", async () => {
  for (const kind of ["generation", "foreign", "duplicate", "query", "ranking", "lexical"]) {
    let calls = 0;
    const service = new RelevanceRunService(fs, inventory, {
      search: (root, query, options) =>
        observation(root, query, options).pipe(
          Effect.map((report) => {
            calls++;
            if (calls === 2) {
              if (kind === "generation") report.publication.fingerprint = "changed";
              if (kind === "foreign") report.results[0]!.record.id = "foreign";
              if (kind === "duplicate") report.results.push(report.results[0]!);
              if (kind === "query") report.query = "wrong query";
              if (kind === "ranking") report.ranking = "jev-relevance";
              if (kind === "lexical") report.results[0]!.source = "lexical-fallback";
            }
            return report;
          }),
        ),
    });
    const report = await Effect.runPromise(service.run(suitePath, root, options));
    assert.equal(report.complete, false, kind);
    assert.equal(report.metrics, null, kind);
    assert.equal(report.outcomes[1]?.state, "failed", kind);
  }
});

test("all corpora preflight before search and final currency failures suppress metrics", async () => {
  for (const failAt of [2, 4]) {
    let discoveries = 0;
    let searches = 0;
    const service = new RelevanceRunService(
      fs,
      {
        discover: (root) =>
          inventory.discover(root).pipe(
            Effect.map((result) => {
              discoveries++;
              return discoveries === failAt ? { ...result, complete: false } : result;
            }),
          ),
      },
      {
        search: (root, query, options) => {
          searches++;
          return observation(root, query, options);
        },
      },
    );
    const result = await Effect.runPromise(Effect.either(service.run(suitePath, root, options)));
    if (failAt === 2) {
      assert.ok(Either.isLeft(result));
      assert.equal(searches, 0);
    } else {
      assert.ok(Either.isRight(result));
      assert.equal(result.right.complete, false);
      assert.equal(result.right.metrics, null);
      assert.equal(result.right.currencyFailures.length, 1);
      assert.equal(searches, 12);
    }
  }
});

test("suite parsing and resolution reject stale, ambiguous or unsafe labels", async () => {
  const raw = JSON.parse(await readFile(suitePath, "utf8"));
  const valid = parseSuite(raw);
  for (const mutate of [
    (data: typeof valid) => {
      data.corpora[0]!.scope = "../escape";
    },
    (data: typeof valid) => {
      data.corpora[0]!.chunks[0]!.path = "/escape";
    },
    (data: typeof valid) => {
      data.corpora[0]!.chunks[0]!.startLine = 0;
    },
    (data: typeof valid) => {
      data.corpora[0]!.files["session.ts"] = "bad-hash";
    },
    (data: typeof valid) => {
      data.corpora[0]!.cases[0]!.relevant = ["unknown"];
    },
    (data: typeof valid) => {
      data.corpora[0]!.cases.push(data.corpora[0]!.cases[0]!);
    },
    (data: typeof valid) => {
      data.corpora[0]!.chunks.push(data.corpora[0]!.chunks[0]!);
    },
  ]) {
    const data = structuredClone(valid);
    mutate(data);
    assert.throws(
      () => parseSuite(data),
      (error) => error instanceof AppError && error.code === "INVALID_DATA",
    );
  }
  for (const value of [null, [], {}, { schemaVersion: 1, corpora: [] }])
    assert.throws(() => parseSuite(value), AppError);
  const items = await Effect.runPromise(inventory.discover(resolve(root, "code")));
  assert.equal(resolveLabels(valid.corpora[0]!, items).size, 1);
  items.resources[0]!.resourceHash = "changed";
  assert.throws(() => resolveLabels(valid.corpora[0]!, items), AppError);
});

test("runner rejects invalid cutoffs before discovery and preserves cancellation", async () => {
  let calls = 0;
  const service = new RelevanceRunService(fs, inventory, {
    search: () => {
      calls++;
      return Effect.interrupt;
    },
  });
  for (const invalid of [
    { ...options, topK: 0 },
    { ...options, topK: 51 },
    { ...options, topK: 1.5 },
    { ...options, topK: 9, rerank: true },
  ]) {
    const result = await Effect.runPromise(
      Effect.either(service.run("missing-suite.json", root, invalid)),
    );
    assert.ok(Either.isLeft(result));
    assert.equal(result.left.code, "INVALID_ARGUMENT");
  }
  assert.equal(calls, 0);
  const exit = await Effect.runPromiseExit(service.run(suitePath, root, options));
  assert.ok(Exit.isFailure(exit));
  assert.ok(Cause.isInterrupted(exit.cause));
  assert.equal(calls, 1);
});

test("paid runner CLI refuses work without explicit acknowledgement and complete policy options", () => {
  for (const extra of [
    [],
    ["--run-paid"],
    ["--run-paid", "--policy", "unknown"],
    ["--run-paid", "--policy", "rerank-min-relevance"],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli/index.ts",
        "benchmark-relevance",
        suitePath,
        "--root",
        root,
        "--top-k",
        "8",
        "--json",
        ...extra,
      ],
      { encoding: "utf8", env: { ...process.env, TYPESAFE_API_KEY: "", PATH: "" } },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /INVALID_ARGUMENT/);
  }
});
