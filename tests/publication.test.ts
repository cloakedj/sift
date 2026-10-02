import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { onboard } from "./support/runtime.js";
import { fakeJev } from "./support/jev.js";
import { publishVectors, publicationStatus, PublicationLive } from "../src/publication/index.js";
import { LocalRuntimeLive } from "../src/runtime/index.js";
import { CloudflarePublicationClient } from "../src/publication/client.js";
import { summarizeStatus } from "../src/publication/utils.js";
import type { PublicationManifest } from "../src/publication/types.js";

const config = {
  accountId: "account",
  apiToken: "secret",
  vectorizeIndex: "index",
  model: "@cf/baai/bge-base-en-v1.5",
};

test("embedding preflight enforces byte and batch bounds without provider calls", async () => {
  const original = globalThis.fetch;
  const client = new CloudflarePublicationClient(config);
  let calls = 0;
  try {
    globalThis.fetch = ((_url, init) => {
      calls++;
      const request = JSON.parse(init!.body as string) as { text: string[] };
      return Promise.resolve(
        Response.json({
          success: true,
          result: {
            data: request.text.map(() => Array(768).fill(1)),
            pooling: "cls",
          },
        }),
      );
    }) as typeof fetch;
    assert.deepEqual(await Effect.runPromise(client.embed([])), []);
    const cases = [
      { texts: [""], code: "INVALID_ARGUMENT" },
      { texts: ["valid", "\u0000\u0001"], code: "INVALID_ARGUMENT" },
      { texts: [" \n\t"], code: "INVALID_ARGUMENT" },
      { texts: ["valid", "x".repeat(501)], code: "PAYLOAD_LIMIT" },
      { texts: ["é".repeat(251)], code: "PAYLOAD_LIMIT" },
      { texts: ["😀".repeat(126)], code: "PAYLOAD_LIMIT" },
      { texts: Array(17).fill("valid") as string[], code: "PAYLOAD_LIMIT" },
    ];
    for (const { texts, code } of cases) {
      const result = await Effect.runPromise(Effect.either(client.embed(texts)));
      assert.equal(result._tag, "Left");
      if (result._tag === "Left") assert.equal(result.left.code, code);
    }
    const unsupported = await Effect.runPromise(
      Effect.either(
        new CloudflarePublicationClient({ ...config, model: "unknown-model" }).embed(["hello"]),
      ),
    );
    assert.equal(unsupported._tag, "Left");
    if (unsupported._tag === "Left") assert.equal(unsupported.left.code, "CONFIGURATION");
    assert.equal(calls, 0);
    for (const text of ["x".repeat(500), "é".repeat(250), "😀".repeat(125)])
      assert.equal((await Effect.runPromise(client.embed([text]))).length, 1);
    assert.equal((await Effect.runPromise(client.embed(Array(16).fill("valid")))).length, 16);
    assert.equal(calls, 4);
  } finally {
    globalThis.fetch = original;
  }
});

test("Cloudflare adapter pins pooling, validates vectors and uses NDJSON multipart mutations", async () => {
  const original = globalThis.fetch;
  const client = new CloudflarePublicationClient(config);
  try {
    globalThis.fetch = ((_url, init) => {
      assert.deepEqual(JSON.parse(init!.body as string), { text: ["hello"], pooling: "cls" });
      return Promise.resolve(
        Response.json({ success: true, result: { data: [Array(768).fill(1)], pooling: "cls" } }),
      );
    }) as typeof fetch;
    assert.equal((await Effect.runPromise(client.embed(["hello"])))[0]!.length, 768);
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({ success: true, result: { data: [[1]], pooling: "cls" } }),
      )) as typeof fetch;
    const invalid = await Effect.runPromise(Effect.either(client.embed(["hello"])));
    assert.equal(invalid._tag, "Left");
    globalThis.fetch = ((_url, init) => {
      assert.ok(init!.body instanceof FormData);
      assert.ok(init!.body.get("vectors") instanceof Blob);
      return Promise.resolve(Response.json({ success: true, result: { mutationId: "mutation" } }));
    }) as typeof fetch;
    assert.equal(
      await Effect.runPromise(
        client.upsert([
          { id: "id", namespace: "isolated", values: Array(768).fill(1), metadata: {} },
        ]),
      ),
      "mutation",
    );
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({ success: false, errors: [{ message: "secret provider body" }] }),
      )) as typeof fetch;
    const failed = await Effect.runPromise(Effect.either(client.embed(["hello"])));
    assert.equal(failed._tag, "Left");
    assert.ok(!JSON.stringify(failed).includes("secret provider body"));
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({ success: true, result: { config: { dimensions: 384, metric: "cosine" } } }),
      )) as typeof fetch;
    assert.equal((await Effect.runPromise(Effect.either(client.verifyIndex())))._tag, "Left");
    const vector = {
      id: "expected",
      namespace: "generation",
      values: Array(768).fill(1),
      metadata: {},
    };
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({
          success: true,
          result: { matches: [{ id: "expected", namespace: "old", score: 1 }] },
        }),
      )) as typeof fetch;
    assert.equal(await Effect.runPromise(client.visible(vector)), false);
    globalThis.fetch = (() =>
      Promise.resolve(Response.json({ success: true, result: { matches: [] } }))) as typeof fetch;
    assert.equal(await Effect.runPromise(client.visible(vector)), false);
    let attempts = 0;
    globalThis.fetch = (() => {
      attempts++;
      return Promise.resolve(
        attempts < 3
          ? new Response(null, { status: 503 })
          : Response.json({
              success: true,
              result: { config: { dimensions: 768, metric: "cosine" } },
            }),
      );
    }) as typeof fetch;
    await Effect.runPromise(client.verifyIndex());
    assert.equal(attempts, 3);
    attempts = 0;
    globalThis.fetch = (() => {
      attempts++;
      return Promise.resolve(new Response(null, { status: 403 }));
    }) as typeof fetch;
    assert.equal((await Effect.runPromise(Effect.either(client.verifyIndex())))._tag, "Left");
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("status never activates an unverified publication or mistakes acceptance for visibility", () => {
  const publication: PublicationManifest = {
    schemaVersion: 2,
    fingerprint: "fingerprint",
    visible: [],
    root: ".",
    state: "pending",
    namespace: "isolated",
    mutations: ["mutation"],
    embeddingSpace: {
      provider: "cloudflare-workers-ai",
      model: config.model,
      dimensions: 768,
      pooling: "cls",
      metric: "cosine",
    },
    vectorBackend: { provider: "cloudflare-vectorize", index: "index", accountId: "account" },
    sourceIndexRunId: "old",
    expected: 1,
    published: ["id"],
    failures: [],
    startedAt: "",
    finishedAt: "",
  };
  const status = summarizeStatus(".", undefined, publication);
  assert.equal(status.activeEmbeddingSpace, undefined);
  assert.equal(status.recordsComplete, false);
  assert.ok(status.findings.some((finding) => finding.message.includes("not active")));
});

test("publication resumes cached embeddings after failed upsert and requires query visibility; stale sources deactivate status", async () => {
  const root = await mkdtemp(join(tmpdir(), "sift-publication-"));
  const originalFetch = globalThis.fetch;
  const keys = [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_VECTORIZE_INDEX",
    "CLOUDFLARE_WORKERS_AI_MODEL",
  ];
  const previous = keys.map((key) => process.env[key]);
  let embeddings = 0;
  let upserts = 0;
  let failUpsert = true;
  let stored: { id: string; namespace: string }[] = [];
  let deletions = 0;
  const run = <A>(
    effect: Effect.Effect<
      A,
      import("../src/errors/index.js").AppError,
      import("../src/publication/index.js").Publication
    >,
  ) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(PublicationLive), Effect.provide(LocalRuntimeLive)),
    );
  try {
    process.env.CLOUDFLARE_ACCOUNT_ID = config.accountId;
    process.env.CLOUDFLARE_API_TOKEN = config.apiToken;
    process.env.CLOUDFLARE_VECTORIZE_INDEX = config.vectorizeIndex;
    delete process.env.CLOUDFLARE_WORKERS_AI_MODEL;
    await writeFile(join(root, "sample.txt"), "Tiny example document.");
    await onboard(root, fakeJev().client);
    // Controlled short projections isolate publication mechanics from Jev quality.
    for (const file of await readdir(join(root, ".sift", "records"))) {
      const path = join(root, ".sift", "records", file);
      const record = JSON.parse(await readFile(path, "utf8"));
      record.embeddingDocument = "Tiny embedding input";
      await writeFile(path, JSON.stringify(record));
    }
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
          result: { pooling: "cls", data: [Array(768).fill(1)] },
        });
      }
      if (path.endsWith("/delete_by_ids")) {
        deletions++;
        const active = JSON.parse(await readFile(join(root, ".sift", "publication.json"), "utf8"));
        assert.equal(active.state, "complete", "activation must be durable before deletion");
        const { ids } = JSON.parse(init!.body as string) as { ids: string[] };
        assert.ok(ids.every((id) => !active.published.includes(id)));
        stored = stored.filter((vector) => !ids.includes(vector.id));
        return Response.json({ success: true, result: { mutationId: "deletion" } });
      }
      if (path.endsWith("/upsert")) {
        upserts++;
        if (failUpsert) return new Response("secret", { status: 403 });
        const blob = (init!.body as FormData).get("vectors") as Blob;
        const incoming = (await blob.text())
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        stored = [
          ...new Map([...stored, ...incoming].map((vector) => [vector.id, vector])).values(),
        ];
        return Response.json({ success: true, result: { mutationId: "mutation" } });
      }
      assert.ok(path.endsWith("/query"));
      const query = JSON.parse(init!.body as string);
      assert.ok(stored.some((vector) => vector.namespace === query.namespace));
      return Response.json({
        success: true,
        result: {
          matches: stored
            .filter((vector) => vector.namespace === query.namespace)
            .map((vector) => ({ ...vector, score: 1 })),
        },
      });
    }) as typeof fetch;
    await assert.rejects(run(publishVectors(root)));
    assert.equal(embeddings, 1);
    failUpsert = false;
    const published = await run(publishVectors(root));
    assert.equal(published.state, "complete");
    assert.equal(published.visible.length, published.expected);
    assert.equal(embeddings, 1);
    const resumed = await run(publishVectors(root));
    assert.equal(resumed.namespace, published.namespace);
    assert.equal(upserts, 2);
    assert.equal(embeddings, 1);
    // Recover remotely accepted vectors when their local publication IDs were lost.
    await writeFile(
      join(root, ".sift", "publication.json"),
      JSON.stringify({ ...resumed, published: [] }),
    );
    assert.equal((await run(publishVectors(root))).published.length, resumed.expected);
    assert.equal((await run(publicationStatus(root))).complete, true);
    assert.equal(upserts, 2);
    // Lost remote data is repaired from the durable embedding cache.
    stored = [];
    assert.equal((await run(publishVectors(root))).state, "complete");
    assert.equal(upserts, 3);
    assert.equal(embeddings, 1);
    // Correct IDs with incorrect metadata must also be repaired.
    stored = stored.map((vector) => ({ id: vector.id, namespace: vector.namespace }));
    assert.equal((await run(publishVectors(root))).state, "complete");
    assert.equal(upserts, 4);
    assert.equal(embeddings, 1);
    const recordPath = join(
      root,
      ".sift",
      "records",
      (await readdir(join(root, ".sift", "records")))[0]!,
    );
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    // A changed semantic generation with identical embedding text needs no AI call.
    record.provenance.projectionVersion = "different-projection-version";
    await writeFile(recordPath, JSON.stringify(record));
    const next = await run(publishVectors(root));
    assert.equal(next.state, "complete");
    assert.notEqual(next.namespace, published.namespace);
    assert.equal(embeddings, 1);
    assert.equal(upserts, 5);
    assert.equal(next.cleanup?.pending.length, 1);
    assert.equal(deletions, 0);
    record.embeddingDocument = "Changed embedding input";
    await writeFile(recordPath, JSON.stringify(record));
    const changed = await run(publishVectors(root));
    assert.equal(changed.state, "complete");
    assert.equal(embeddings, 2);
    assert.equal(changed.cleanup?.pending.length, 2);
    assert.equal(deletions, 0);
    // Simulate expiry; publish retries cleanup without embedding or upserting again.
    changed.cleanup!.pending.forEach((item) => {
      item.notBefore = new Date(0).toISOString();
    });
    await writeFile(join(root, ".sift", "publication.json"), JSON.stringify(changed));
    const cleaned = await run(publishVectors(root));
    assert.equal(cleaned.cleanup?.pending.length, 0);
    assert.equal(deletions, 1);
    assert.equal(stored.length, 1);
    assert.equal(embeddings, 2);
    assert.equal(upserts, 6);
    globalThis.fetch = (() => assert.fail("status must not call Cloudflare")) as typeof fetch;
    assert.equal((await run(publicationStatus(root))).complete, true);
    await writeFile(join(root, "sample.txt"), "Changed content.");
    const status = await run(publicationStatus(root));
    assert.equal(status.complete, false);
    assert.equal(status.activeEmbeddingSpace, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
    await rm(root, { recursive: true, force: true });
  }
});
