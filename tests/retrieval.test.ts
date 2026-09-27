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
  const root = await mkdtemp(join(tmpdir(), "jev-retrieval-"));
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
  try {
    process.env.CLOUDFLARE_ACCOUNT_ID = config.accountId;
    process.env.CLOUDFLARE_API_TOKEN = config.apiToken;
    process.env.CLOUDFLARE_VECTORIZE_INDEX = config.vectorizeIndex;
    process.env.TYPESAFE_DEFAULT_MODEL = intentClient.model;
    process.env.TYPESAFE_API_KEY = "";
    delete process.env.CLOUDFLARE_WORKERS_AI_MODEL;
    await writeFile(join(root, "sample.txt"), "Tiny retrieval example.");
    await onboard(root, fakeJev().client);
    for (const file of await readdir(join(root, ".jev", "records"))) {
      const path = join(root, ".jev", "records", file);
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
          result: { pooling: "cls", data: [Array(768).fill(embeddings)] },
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
      return Response.json({
        success: true,
        result: { matches: stored.map((vector) => ({ ...vector, score: 0.91 })) },
      });
    }) as typeof fetch;
    await Effect.runPromise(
      publishVectors(root).pipe(Effect.provide(PublicationLive), Effect.provide(LocalRuntimeLive)),
    );
    const report = await Effect.runPromise(
      searchSemantic(root, "explain retrieval", { explain: true }).pipe(
        Effect.provide(RetrievalLive),
        Effect.provide(IntentLive),
        Effect.provide(PublicationLive),
        Effect.provide(LocalRuntimeLive),
      ),
    );
    assert.equal(report.reusedIntent, true);
    assert.equal(report.results.length, 1);
    assert.equal(report.results[0]!.score, 0.91);
    assert.equal(report.results[0]!.record.resource.textPreview, "Tiny retrieval example.");
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
        searchSemantic(root, "explain retrieval", options).pipe(
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
    await Effect.runPromise(
      Effect.flatMap(Reranking, (service) =>
        service.rank(root, report.intent!, report.results, new JevService(intentClient, false)),
      ).pipe(Effect.provide(RerankingLive), Effect.provide(LocalRuntimeLive)),
    );
    process.env.TYPESAFE_API_KEY = "unused-cache-hit-key";
    const reranked = await search({ rerank: true, explain: true });
    assert.deepEqual(reranked.judgments, { reused: 1, new: 0 });
    assert.equal(reranked.results[0]!.relevance!.score, 0);
    assert.equal((await search({ rerank: true })).judgments, undefined);
    assert.equal((await search({ explain: true })).judgments, undefined);
    const semanticFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const response = await semanticFetch(url, init);
      if (!String(url).endsWith("/query")) return response;
      return Response.json({ success: true, result: { matches: [] } });
    }) as typeof fetch;
    const noFallback = await search({ explain: true });
    assert.equal(noFallback.results.length, 0);
    assert.match(noFallback.findings.at(-1)!.message, /fallback is disabled/);
    const fallback = await search({ explain: true, lexicalFallback: true });
    assert.equal(fallback.results[0]!.source, "lexical-fallback");
    assert.ok(fallback.timings.some((timing) => timing.stage === "lexical-fallback"));
    assert.match(fallback.findings.at(-1)!.message, /explicitly enabled/);
    globalThis.fetch = semanticFetch;
    process.env.CLOUDFLARE_VECTORIZE_INDEX = "other-index";
    await assert.rejects(search(), /does not match the active publication/);
    process.env.CLOUDFLARE_VECTORIZE_INDEX = config.vectorizeIndex;
    const publicationPath = join(root, ".jev", "publication.json");
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
