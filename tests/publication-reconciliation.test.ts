import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { reconcileVectors } from "../src/publication/utils.js";
import { CloudflarePublicationClient } from "../src/publication/client.js";
import type { EmbeddingVector, RemoteVector } from "../src/publication/types.js";

test("reconciliation separates missing, mismatched, extra, and stale without owning other corpora", () => {
  const expected: EmbeddingVector[] = ["ok", "missing", "mismatched"].map((id) => ({
    id,
    namespace: "active",
    values: [1],
    metadata: { corpus_id: "ours", embedding_space_id: "space" },
  }));
  const remote: RemoteVector[] = [
    { ...expected[0]! },
    { ...expected[2]!, metadata: { corpus_id: "ours", embedding_space_id: "wrong" } },
    { id: "extra", namespace: "active", metadata: {} },
    { id: "old", namespace: "old-generation", metadata: { corpus_id: "ours" } },
    { id: "legacy", namespace: "legacy-generation", metadata: {} },
    { id: "unrelated", namespace: "other", metadata: { corpus_id: "theirs" } },
  ];
  const result = reconcileVectors(expected, remote, "active", "ours", ["legacy"]);
  assert.deepEqual(result.missing, ["missing"]);
  assert.deepEqual(result.mismatched, ["mismatched"]);
  assert.deepEqual(result.extra, ["extra"]);
  assert.deepEqual(result.stale, ["old", "legacy"]);
});

test("Vectorize reconciliation paginates, rejects cursor loops and sends documented get-by-ids envelope", async () => {
  const client = new CloudflarePublicationClient({
    accountId: "account",
    apiToken: "secret",
    vectorizeIndex: "index",
    model: "model",
  });
  const original = globalThis.fetch;
  try {
    const requests: string[] = [];
    globalThis.fetch = ((url) => {
      requests.push(String(url));
      return Promise.resolve(
        Response.json({
          success: true,
          result:
            requests.length === 1
              ? { vectors: [{ id: "a" }], isTruncated: true, nextCursor: "next" }
              : { vectors: [{ id: "b" }], isTruncated: false },
        }),
      );
    }) as typeof fetch;
    assert.deepEqual(await Effect.runPromise(client.listVectors()), ["a", "b"]);
    assert.ok(requests[1]!.includes("cursor=next"));
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({
          success: true,
          result: { vectors: [], isTruncated: true, nextCursor: "loop" },
        }),
      )) as typeof fetch;
    assert.equal((await Effect.runPromise(Effect.either(client.listVectors())))._tag, "Left");
    globalThis.fetch = ((_url, init) => {
      assert.deepEqual(JSON.parse(init!.body as string), { ids: ["a"] });
      return Promise.resolve(Response.json({ success: true, result: [{ id: "a", metadata: {} }] }));
    }) as typeof fetch;
    assert.equal(
      (
        await Effect.runPromise(
          Effect.either(client.getVectors(Array.from({ length: 21 }, (_, index) => String(index)))),
        )
      )._tag,
      "Left",
    );
    assert.deepEqual(await Effect.runPromise(client.getVectors(["a"])), [
      { id: "a", namespace: "", metadata: {} },
    ]);
    globalThis.fetch = ((url, init) => {
      assert.ok(String(url).endsWith("/delete_by_ids"));
      assert.deepEqual(JSON.parse(init!.body as string), { ids: ["old"] });
      return Promise.resolve(Response.json({ success: true, result: { mutationId: "deleted" } }));
    }) as typeof fetch;
    assert.equal(await Effect.runPromise(client.deleteVectors(["old"])), "deleted");
    assert.equal((await Effect.runPromise(Effect.either(client.deleteVectors([]))))._tag, "Left");
    assert.equal(
      (await Effect.runPromise(Effect.either(client.deleteVectors(["old", "old"]))))._tag,
      "Left",
    );
  } finally {
    globalThis.fetch = original;
  }
});
