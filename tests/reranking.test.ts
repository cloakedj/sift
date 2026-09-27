import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { RELEVANCE_CRITERIA } from "../src/retrieval/reranking/consts.js";
import { requestFingerprint } from "../src/retrieval/reranking/utils.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { Errors } from "../src/errors/index.js";
import { Reranking, RerankingLive } from "../src/retrieval/reranking/index.js";
import { LocalRuntimeLive } from "../src/runtime/index.js";
import { inspectRecords } from "../src/onboarding/inspect.js";
import { JevService } from "../src/typesafe/client.js";
import type { JevClient } from "../src/typesafe/types.js";
import type { QueryIntent } from "../src/intent/types.js";
import type { SearchResult } from "../src/retrieval/types.js";
import { onboard } from "./support/runtime.js";
import { fakeJev } from "./support/jev.js";

test("reranking fingerprints include rubric text and explicit version", () => {
  const request = { model: "pinned", state: { text: "source" }, questions: {} };
  assert.notEqual(requestFingerprint(request, "v1"), requestFingerprint(request, "v2"));
  assert.equal(
    requestFingerprint(request, "v1"),
    requestFingerprint(structuredClone(request), "v1"),
  );
});

const intent: QueryIntent = {
  schemaVersion: 1,
  rawQuery: "restore access without deleting sessions",
  kind: "find_implementation",
  confidence: 1,
  positiveTerms: ["restore access"],
  negativeSignals: ["deleting sessions"],
  unmatchedCandidates: [],
  taxonomy: {
    domains: [],
    concepts: [],
    operations: [],
    dependencies: [],
    risks: [],
    evidenceKinds: [],
  },
  embeddingDocument: "restore access",
  provenance: {
    model: "test-pinned-model",
    taxonomyVersion: "test",
    questionSetVersion: "test",
    fingerprint: "test",
  },
};

test("reranking judges full current source, reorders tied vectors, and fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-reranking-"));
  try {
    const longText = "// Context " + "x".repeat(260) + "\nrestoreAccess();\n";
    await writeFile(join(root, "restore.ts"), longText);
    await writeFile(join(root, "delete.ts"), "deleteSessions();\n");
    await onboard(root, fakeJev().client);
    const inspected = await Effect.runPromise(
      inspectRecords(root).pipe(Effect.provide(LocalRuntimeLive)),
    );
    const candidates: SearchResult[] = inspected.records.map((record, index) => ({
      rank: index + 1,
      score: 0.5,
      vectorId: record.id,
      record,
    }));
    let calls = 0;
    let active = 0;
    let peakActive = 0;
    const transport: JevClient = {
      model: intent.provenance.model,
      async evaluate(request) {
        calls++;
        active++;
        peakActive = Math.max(peakActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
        const state = request.state as {
          candidate: { text: string };
          intent: { negativeSignals: string[] };
        };
        assert.deepEqual(state.intent.negativeSignals, intent.negativeSignals);
        const relevant = state.candidate.text.includes("restoreAccess");
        if (relevant) assert.equal(state.candidate.text, longText);
        return {
          model: this.model,
          answers: {
            relevance: {
              type: "score",
              score: relevant ? 2 : 0,
              confidence: 0.9,
              probabilities: relevant ? { 0: 0, 1: 0, 2: 1 } : { 0: 1, 1: 0, 2: 0 },
              legend: { 0: "Unsupported", 1: "Related", 2: "Direct" },
            },
          },
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    };
    const rank = (client = transport, selected = candidates, queryIntent = intent) =>
      Effect.runPromise(
        Effect.flatMap(Reranking, (service) =>
          service.rank(root, queryIntent, selected, new JevService(client, false)),
        ).pipe(Effect.provide(RerankingLive), Effect.provide(LocalRuntimeLive)),
      );
    const first = await rank();
    const ranked = first.results;
    assert.deepEqual(first.judgments, { reused: 0, new: candidates.length });
    assert.equal(calls, candidates.length);
    assert.ok(ranked[0]!.record.resource.uri.endsWith("restore.ts"));
    assert.equal(ranked[0]!.relevance!.score, 1);
    assert.equal(ranked[1]!.relevance!.score, 0);
    assert.equal(ranked[0]!.score, 0.5);
    assert.equal(ranked[0]!.rank, 1);
    const repeat = await rank();
    assert.equal(repeat.results[0]!.relevance!.fingerprint, ranked[0]!.relevance!.fingerprint);
    assert.deepEqual(repeat.judgments, { reused: candidates.length, new: 0 });
    assert.equal(calls, candidates.length);
    await assert.rejects(rank({ ...transport, model: "different-model" }), /pinned model/);
    await assert.rejects(rank(transport, Array(9).fill(candidates[0])), /eight candidates/);
    await assert.rejects(
      rank(transport, candidates, { ...intent, rawQuery: "x".repeat(40_000) }),
      /byte guardrail/,
    );
    assert.equal(calls, candidates.length);
    await assert.rejects(
      rank(
        {
          ...transport,
          async evaluate() {
            return { model: this.model, answers: {}, usage: { input_tokens: 0, output_tokens: 0 } };
          },
        },
        candidates,
        { ...intent, rawQuery: "uncached malformed query" },
      ),
      /Invalid Jev answer type/,
    );
    await rank(
      transport,
      Array.from({ length: 8 }, (_, index) => ({ ...candidates[0]!, vectorId: String(index) })),
      { ...intent, rawQuery: "concurrency query" },
    );
    assert.equal(peakActive, 3);
    await assert.rejects(
      rank(
        {
          ...transport,
          async evaluate() {
            return Promise.reject(Errors.create("PROVIDER", "Controlled rerank provider failure"));
          },
        },
        candidates,
        { ...intent, rawQuery: "uncached failing query" },
      ),
      /Controlled rerank provider failure/,
    );
    const changedQuery = await rank(transport, candidates, {
      ...intent,
      rawQuery: "different query",
    });
    assert.deepEqual(changedQuery.judgments, { reused: 0, new: candidates.length });
    const changedModel = await rank({ ...transport, model: "another-pinned-model" }, candidates, {
      ...intent,
      provenance: { ...intent.provenance, model: "another-pinned-model" },
    });
    assert.deepEqual(changedModel.judgments, { reused: 0, new: candidates.length });
    const criteria = RELEVANCE_CRITERIA as unknown as string[];
    const originalCriterion = criteria[0]!;
    try {
      criteria[0] = "A revised unsupported-answer rubric";
      assert.deepEqual((await rank()).judgments, { reused: 0, new: candidates.length });
    } finally {
      criteria[0] = originalCriterion;
    }
    const cachePath = join(root, ".jev", "reranking", `${ranked[0]!.relevance!.fingerprint}.json`);
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    cached.response.answers.relevance.score = 99;
    await writeFile(cachePath, JSON.stringify(cached));
    assert.deepEqual((await rank()).judgments, { reused: candidates.length - 1, new: 1 });
    await writeFile(cachePath, "{");
    await assert.rejects(rank(), /Invalid stored data/);
    await rm(cachePath);
    await rank();
    await writeFile(join(root, "restore.ts"), "changed();\n");
    await assert.rejects(rank(), /source changed/);
    await onboard(root, fakeJev().client);
    const refreshed = await Effect.runPromise(
      inspectRecords(root).pipe(Effect.provide(LocalRuntimeLive)),
    );
    const changedCandidates = refreshed.records.map((record, index) => ({
      rank: index + 1,
      score: 0.5,
      vectorId: record.id,
      record,
    }));
    assert.deepEqual((await rank(transport, changedCandidates)).judgments, { reused: 1, new: 1 });
    assert.deepEqual(await rank(transport, []), { results: [], judgments: { reused: 0, new: 0 } });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
