import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { CloudflarePublicationClient } from "../src/publication/client.js";

test("retrieval query scopes the generation and validates response and request bounds", async () => {
  const original = globalThis.fetch;
  const vector = Array(768).fill(1);
  const client = new CloudflarePublicationClient({
    accountId: "account",
    apiToken: "secret",
    vectorizeIndex: "index",
    model: "model",
  });
  try {
    globalThis.fetch = ((_url, init) => {
      assert.deepEqual(JSON.parse(init!.body as string), {
        vector,
        namespace: "generation",
        topK: 8,
        returnMetadata: "all",
        returnValues: false,
      });
      return Promise.resolve(Response.json({ success: true, result: { matches: [] } }));
    }) as typeof fetch;
    assert.deepEqual(await Effect.runPromise(client.query(vector, "generation", 8)), []);
    for (const result of [
      null,
      {},
      { matches: [{ id: "id", score: "wrong" }] },
      { matches: [{ id: "id", score: 1, metadata: null }] },
    ]) {
      globalThis.fetch = (() =>
        Promise.resolve(Response.json({ success: true, result }))) as typeof fetch;
      assert.equal(
        (await Effect.runPromise(Effect.either(client.query(vector, "generation", 8))))._tag,
        "Left",
      );
    }
    globalThis.fetch = (() =>
      assert.fail("invalid inputs must not contact provider")) as typeof fetch;
    for (const topK of [0, 51, 1.5, Number.NaN])
      assert.equal(
        (await Effect.runPromise(Effect.either(client.query(vector, "generation", topK))))._tag,
        "Left",
      );
    for (const values of [[1], Array(768).fill(0), Array(768).fill(Number.NaN)])
      assert.equal(
        (await Effect.runPromise(Effect.either(client.query(values, "generation", 8))))._tag,
        "Left",
      );
  } finally {
    globalThis.fetch = original;
  }
});
