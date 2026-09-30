import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { Intent, IntentLive } from "../src/intent/index.js";
import { publishVectors, PublicationLive } from "../src/publication/index.js";
import { searchSemantic, RetrievalLive } from "../src/retrieval/index.js";
import { Reranking, RerankingLive } from "../src/retrieval/reranking/index.js";
import { LocalRuntimeLive } from "../src/runtime/index.js";
import { JevService } from "../src/typesafe/client.js";
import { onboard } from "./support/runtime.js";
import { fakeJev } from "./support/jev.js";
import type { JevClient } from "../src/typesafe/types.js";
import type { SearchOptions } from "../src/retrieval/types.js";

const config = {
  accountId: "account",
  apiToken: "secret",
  vectorizeIndex: "index",
  model: "@cf/baai/bge-base-en-v1.5",
};

const intentClient: JevClient = {
  model: "intent-test-v1",
  async evaluate(request) {
    const answers: Record<string, Awaited<ReturnType<JevClient["evaluate"]>>["answers"][string]> =
      {};
    for (const [key, question] of Object.entries(request.questions)) {
      if (question.type === "choice") {
        const choice =
          key === "kind" ? "find_explanation" : key === "shape" ? "explanation" : "positive";
        answers[key] = {
          type: "choice",
          choice,
          confidence: 1,
          probabilities: Object.fromEntries(
            Object.keys(question.criteria).map((name) => [name, name === choice ? 1 : 0]),
          ),
        };
      } else if (question.type === "score")
        answers[key] = {
          type: "score",
          score: 0,
          confidence: 1,
          probabilities: { 0: 1, 1: 0, 2: 0 },
          legend: { 0: "Not relevant", 1: "Secondary", 2: "Central" },
        };
    }
    return { model: request.model!, answers, usage: { input_tokens: 1, output_tokens: 1 } };
  },
};

test("semantic search returns source-linked active publication matches from cached intent", async () => {
  const root = await mkdtemp(join(tmpdir(), "sift-retrieval-"));
  const originalFetch = globalThis.fetch;
  const keys = [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_VECTORIZE_INDEX",
    "CLOUDFLARE_WORKERS_AI_MODEL",
    "TYPESAFE_DEFAULT_MODEL",
    "TYPESAFE_API_KEY",
  ];
  const previous = keys.map((key) => process.env[key]);
  let stored: { id: string; namespace: string; metadata?: Record<string, unknown> }[] = [];
  let embeddings = 0;
  let requestedTopK = 0;
  try {
    process.env.CLOUDFLARE_ACCOUNT_ID = config.accountId;
    process.env.CLOUDFLARE_API_TOKEN = config.apiToken;
    process.env.CLOUDFLARE_VECTORIZE_INDEX = config.vectorizeIndex;
    process.env.TYPESAFE_DEFAULT_MODEL = intentClient.model;
    process.env.TYPESAFE_API_KEY = "";
    delete process.env.CLOUDFLARE_WORKERS_AI_MODEL;
    await writeFile(join(root, "sample.txt"), "Tiny retrieval example.");
    await writeFile(join(root, "answer.txt"), "Tiny retrieval example.\n\n");
    await onboard(root, fakeJev().client);
    for (const file of await readdir(join(root, ".sift", "records"))) {
      const path = join(root, ".sift", "records", file);
      const record = JSON.parse(await readFile(path, "utf8"));
      record.embeddingDocument = "Tiny record embedding input";
      await writeFile(path, JSON.stringify(record));
    }
    await Effect.runPromise(
      Effect.flatMap(Intent, (service) =>
        service.infer(
          root,
          "explain retrieval",
          intentClient.model,
          Effect.succeed(new JevService(intentClient, false)),
        ),
      ).pipe(Effect.provide(IntentLive), Effect.provide(LocalRuntimeLive)),
    );
    globalThis.fetch = (async (url, init) => {
      const path = String(url);
      if (path.includes("/list?"))
        return Response.json({
          success: true,
          result: { vectors: stored.map((vector) => ({ id: vector.id })), isTruncated: false },
        });
      if (path.endsWith("/get_by_ids")) {
        const { ids } = JSON.parse(init!.body as string) as { ids: string[] };
        return Response.json({
          success: true,
          result: stored.filter((vector) => ids.includes(vector.id)),
        });
      }
      if (init?.method === "GET")
        return Response.json({
          success: true,
          result: { config: { dimensions: 768, metric: "cosine" } },
        });
      if (path.includes("/ai/run/")) {
        embeddings++;
        return Response.json({
          success: true,
          result: {
            pooling: "cls",
            data: JSON.parse(init!.body as string).text.map(() => Array(768).fill(embeddings)),
          },
        });
      }
      if (path.endsWith("/upsert")) {
        const blob = (init!.body as FormData).get("vectors") as Blob;
        stored = (await blob.text())
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        return Response.json({ success: true, result: { mutationId: "mutation" } });
      }
      assert.ok(path.endsWith("/query"));
      const query = JSON.parse(init!.body as string);
      assert.equal(query.namespace, stored[0]!.namespace);
      requestedTopK = query.topK;
      return Response.json({
        success: true,
        result: {
          matches: stored
            .map((vector, index) => ({ ...vector, score: 0.91 - index * 0.1 }))
            .slice(0, query.topK),
        },
      });
    }) as typeof fetch;
    await Effect.runPromise(
      publishVectors(root).pipe(Effect.provide(PublicationLive), Effect.provide(LocalRuntimeLive)),
    );
    const report = await Effect.runPromise(
      searchSemantic(root, "explain retrieval", { explain: true, discovery: "semantic" }).pipe(
        Effect.provide(RetrievalLive),
        Effect.provide(IntentLive),
        Effect.provide(PublicationLive),
        Effect.provide(LocalRuntimeLive),
      ),
    );
    assert.equal(report.reusedIntent, true);
    assert.equal(report.results.length, 2);
    assert.equal(report.results[0]!.score, 0.91);
    assert.ok(
      report.results.some(
        (match) => match.record.resource.textPreview === "Tiny retrieval example.",
      ),
    );
    assert.ok(report.intent);
    assert.ok(report.timings.some((timing) => timing.stage === "query-intent-cached"));
    assert.ok(report.timings.some((timing) => timing.stage === "query-embedding"));
    assert.ok(report.timings.every((timing) => timing.milliseconds >= 0));
    assert.equal(embeddings, 2);
    const originalStored = structuredClone(stored);
    stored = stored.map((vector) => ({
      ...vector,
      metadata: { ...vector.metadata, content_hash: "wrong" },
    }));
    const search = (options: SearchOptions = {}) =>
      Effect.runPromise(
        searchSemantic(root, "explain retrieval", { discovery: "semantic", ...options }).pipe(
          Effect.provide(RetrievalLive),
          Effect.provide(IntentLive),
          Effect.provide(PublicationLive),
          Effect.provide(LocalRuntimeLive),
        ),
      );
    await assert.rejects(search(), /active-generation validation/);
    stored = originalStored;
    await assert.rejects(search({ rerank: true, topK: 9 }), /between 1 and 8/);
    await assert.rejects(search({ rerank: true }), /Missing TYPESAFE_API_KEY/);
    const preferredText = report.results[1]!.record.resource.textPreview;
    const rankingClient: JevClient = {
      model: intentClient.model,
      async evaluate(request) {
        const response = await intentClient.evaluate(request);
        if (JSON.stringify(request.state).includes(JSON.stringify(preferredText)))
          return {
            ...response,
            answers: {
              ...response.answers,
              relevance: {
                type: "score",
                score: 2,
                confidence: 1,
                probabilities: { 0: 0, 1: 0, 2: 1 },
                legend: { 0: "Not relevant", 1: "Secondary", 2: "Central" },
              },
            },
          };
        return response;
      },
    };
    await Effect.runPromise(
      Effect.flatMap(Reranking, (service) =>
        service.rank(root, report.intent!, report.results, new JevService(rankingClient, false)),
      ).pipe(Effect.provide(RerankingLive), Effect.provide(LocalRuntimeLive)),
    );
    process.env.TYPESAFE_API_KEY = "unused-cache-hit-key";
    const vectorOnly = await search({ topK: 1 });
    assert.equal(requestedTopK, 1);
    assert.equal(vectorOnly.results.length, 1);
    assert.notEqual(vectorOnly.results[0]!.record.resource.textPreview, preferredText);
    const reranked = await search({ rerank: true, explain: true, topK: 1 });
    assert.equal(requestedTopK, 8);
    assert.equal(reranked.results.length, 1);
    assert.deepEqual(reranked.judgments, { reused: 2, new: 0 });
    assert.equal(reranked.results[0]!.relevance!.score, 1);
    assert.equal(reranked.results[0]!.record.resource.textPreview, preferredText);
    assert.equal(reranked.results[0]!.rank, 1);
    assert.equal((await search({ rerank: true })).judgments, undefined);
    const hybrid = await search({ discovery: "hybrid", rerank: true, topK: 1, explain: true });
    assert.equal(hybrid.results[0]!.record.resource.textPreview, preferredText);
    assert.ok(hybrid.results[0]!.discovery!.some((signal) => signal.source === "lexical"));
    assert.ok(hybrid.results[0]!.discovery!.some((signal) => signal.source === "semantic"));
    assert.equal(hybrid.coverage.exhaustive, false);
    assert.equal(hybrid.coverage.assessedPrimaryCandidates, 2);
    assert.equal(hybrid.execution, "complete");
    const budgeted = await search({ discovery: "hybrid", topK: 1 });
    assert.equal(budgeted.ranking, "hybrid");
    assert.equal(budgeted.truncation.results, true);
    assert.equal(budgeted.truncation.omittedResults, 1);
    const anchored = await search({
      discovery: "hybrid",
      anchors: [{ kind: "location", uri: report.results[1]!.record.resource.uri }],
      topK: 1,
    });
    assert.equal(anchored.results[0]!.record.id, report.results[1]!.record.id);
    assert.equal(anchored.results[0]!.source, "anchor");
    await assert.rejects(
      search({ anchors: [{ kind: "literal", value: "Tiny" }] }),
      /Use hybrid discovery/,
    );
    await assert.rejects(
      search({ discovery: "hybrid", anchors: [{ kind: "literal", value: " " }] }),
      /nonempty/,
    );
    assert.equal((await search({ explain: true })).judgments, undefined);
    for (const file of await readdir(join(root, ".sift", "reranking"))) {
      const path = join(root, ".sift", "reranking", file);
      const cached = JSON.parse(await readFile(path, "utf8"));
      cached.response.answers.relevance = {
        type: "score",
        score: 1,
        confidence: 1,
        probabilities: { 0: 0, 1: 1, 2: 0 },
        legend: { 0: "Not relevant", 1: "Secondary", 2: "Central" },
      };
      await writeFile(path, JSON.stringify(cached));
    }
    const insufficient = await search({ rerank: true, explain: true });
    assert.equal(insufficient.evidence.state, "insufficient");
    assert.equal(insufficient.results.length, 0);
    assert.equal(insufficient.candidates!.length, 2);
    assert.equal((await search({ rerank: true, minRelevance: 0 })).results.length, 2);
    await assert.rejects(search({ minRelevance: 0.5 }), /requires --rerank/);
    await assert.rejects(search({ rerank: true, minRelevance: NaN }), /between 0 and 1/);
    const semanticFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const response = await semanticFetch(url, init);
      if (!String(url).endsWith("/query")) return response;
      return Response.json({ success: true, result: { matches: [] } });
    }) as typeof fetch;
    const semanticOnly = await search({ explain: true });
    assert.equal(semanticOnly.results.length, 0);
    const lexical = await search({ explain: true, discovery: "hybrid" });
    assert.equal(lexical.results[0]!.source, "lexical");
    assert.equal(lexical.evidence.state, "not-assessed");
    assert.ok(lexical.timings.some((timing) => timing.stage === "hybrid-discovery"));
    const assessedLexical = await search({ explain: true, discovery: "hybrid", rerank: true });
    assert.equal(assessedLexical.evidence.state, "insufficient");
    assert.equal(assessedLexical.results.length, 0);
    assert.equal(assessedLexical.candidates!.length, 2);
    assert.ok(
      assessedLexical.candidates!.every((hit) => hit.source === "lexical" && hit.relevance),
    );
    assert.deepEqual(assessedLexical.judgments, { reused: 2, new: 0 });
    const noCandidates = await search({ rerank: true });
    assert.equal(noCandidates.evidence.state, "insufficient");
    assert.equal(noCandidates.coverage.assessedPrimaryCandidates, 0);
    globalThis.fetch = semanticFetch;
    process.env.CLOUDFLARE_VECTORIZE_INDEX = "other-index";
    await assert.rejects(search(), /does not match the active publication/);
    process.env.CLOUDFLARE_VECTORIZE_INDEX = config.vectorizeIndex;
    const publicationPath = join(root, ".sift", "publication.json");
    const publicationText = await readFile(publicationPath, "utf8");
    const publication = JSON.parse(publicationText);
    publication.embeddingSpaceId = "incompatible";
    await writeFile(publicationPath, JSON.stringify(publication));
    await assert.rejects(search(), /Incompatible active embedding space/);
    await writeFile(publicationPath, publicationText);
    const workingFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const response = await workingFetch(url, init);
      if (!String(url).endsWith("/query")) return response;
      const body = (await response.json()) as { result: { matches: { namespace: string }[] } };
      body.result.matches[0]!.namespace = "superseded";
      return Response.json(body);
    }) as typeof fetch;
    await assert.rejects(search(), /active-generation validation/);
    globalThis.fetch = (async (url, init) => {
      const response = await workingFetch(url, init);
      if (String(url).endsWith("/query"))
        await writeFile(join(root, "sample.txt"), "Changed during query");
      return response;
    }) as typeof fetch;
    await assert.rejects(search(), /changed during search/);
    await writeFile(join(root, "sample.txt"), "Changed source");
    globalThis.fetch = (() =>
      assert.fail("stale search must not contact Cloudflare")) as typeof fetch;
    await assert.rejects(search(), /complete current vector publication/);
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
    await rm(root, { recursive: true, force: true });
  }
});
