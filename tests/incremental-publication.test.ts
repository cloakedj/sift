import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { Errors } from "../src/errors/index.js";
import { MessageService } from "../src/messages/index.js";
import type { LocalStore, Receipt } from "../src/onboarding/types.js";
import { CloudflarePublicationClient } from "../src/publication/client.js";
import { EmbeddingCache } from "../src/publication/embedding-cache.js";
import { GenerationCleanup } from "../src/publication/cleanup.js";
import { GENERATION_RETENTION_MS, PUBLICATION_FILE } from "../src/publication/consts.js";
import { embeddingCacheKey } from "../src/publication/utils.js";
import type { PublicationManifest, RemoteVector } from "../src/publication/types.js";

class MemoryStore implements LocalStore {
  public entries = new Map<string, unknown>();
  public read<T>(path: string) {
    return Effect.sync(() => structuredClone(this.entries.get(path)) as T | undefined);
  }
  public write(path: string, value: unknown) {
    return Effect.sync(() => {
      this.entries.set(path, structuredClone(value));
    });
  }
  public receipt(_subject: Receipt["subject"], _action: Receipt["action"]) {
    return Effect.succeed("receipt");
  }
}

class ControlledClient extends CloudflarePublicationClient {
  public inputs: string[][] = [];
  public remote = new Map<string, RemoteVector>();
  public deletions: string[][] = [];
  public failDeletion = false;
  public delayDeletion = false;
  public override embed(texts: string[]) {
    return Effect.sync(() => {
      this.inputs.push(texts);
      return texts.map(() => Array(768).fill(1) as number[]);
    });
  }
  public override getVectors(ids: string[]) {
    return Effect.succeed(ids.flatMap((id) => (this.remote.has(id) ? [this.remote.get(id)!] : [])));
  }
  public override deleteVectors(ids: string[]) {
    return this.failDeletion
      ? Errors.fail("CLOUDFLARE", "Controlled deletion failure")
      : Effect.sync(() => {
          this.deletions.push(ids);
          if (!this.delayDeletion) ids.forEach((id) => this.remote.delete(id));
          return "mutation";
        });
  }
}
const config = {
  accountId: "account",
  apiToken: "secret",
  vectorizeIndex: "index",
  model: "model",
};
const messages = new MessageService({ sink: { message() {}, output() {} }, enableProgress: false });

function publication(): PublicationManifest {
  return {
    schemaVersion: 3,
    corpusId: "ours",
    fingerprint: "active",
    namespace: "active",
    root: ".",
    state: "complete",
    verifiedAt: new Date(0).toISOString(),
    sourceIndexRunId: "run",
    visible: ["current"],
    published: ["current"],
    expected: 1,
    mutations: [],
    failures: [],
    startedAt: "",
    finishedAt: "",
    embeddingSpace: {
      provider: "cloudflare-workers-ai",
      model: "model",
      dimensions: 768,
      pooling: "cls",
      metric: "cosine",
    },
    vectorBackend: { provider: "cloudflare-vectorize", accountId: "account", index: "index" },
    reconciliation: {
      observedAt: "",
      missing: [],
      mismatched: [],
      extra: [],
      stale: ["old", "foreign", "legacy"],
    },
  };
}

test("embedding cache reuses exact inputs across generations, deduplicates, migrates legacy and invalidates model changes", async () => {
  const store = new MemoryStore();
  const client = new ControlledClient(config);
  const cache = new EmbeddingCache(store, client, "model");
  assert.equal((await Effect.runPromise(cache.load(["same", "same", "other"]))).length, 3);
  assert.deepEqual(client.inputs, [["same", "other"]]);
  await Effect.runPromise(
    new EmbeddingCache(store, client, "model").load(["other", "same", "new"]),
  );
  assert.deepEqual(client.inputs[1], ["new"]);
  await Effect.runPromise(cache.load(["legacy"], [Array(768).fill(2)]));
  assert.equal(client.inputs.length, 2);
  assert.deepEqual(await Effect.runPromise(cache.load(["legacy"])), [Array(768).fill(2)]);
  await Effect.runPromise(new EmbeddingCache(store, client, "different-model").load(["same"]));
  assert.equal(client.inputs.length, 3);
  assert.notEqual(embeddingCacheKey("same", "model"), embeddingCacheKey("same", "different-model"));
  const key = embeddingCacheKey("corrupt", "model");
  store.entries.set(`embedding-${key}.json`, { key, values: [1] });
  const corrupt = await Effect.runPromise(Effect.either(cache.load(["corrupt"])));
  assert.equal(corrupt._tag, "Left");
  if (corrupt._tag === "Left") assert.equal(corrupt.left.code, "INVALID_DATA");
  assert.equal(client.inputs.length, 3);
});

test("cleanup protects active and foreign vectors, waits for grace, and confirms absence rather than mutation acceptance", async () => {
  const store = new MemoryStore();
  const client = new ControlledClient(config);
  for (const vector of [
    { id: "old", namespace: "old", metadata: { corpus_id: "ours" } },
    { id: "current", namespace: "active", metadata: { corpus_id: "ours" } },
    { id: "foreign", namespace: "other", metadata: { corpus_id: "theirs" } },
    { id: "legacy", namespace: "legacy", metadata: {} },
  ])
    client.remote.set(vector.id, vector);
  const manifest = publication();
  const cleanup = new GenerationCleanup(store, client, messages);
  await Effect.runPromise(cleanup.run(manifest, 1000));
  assert.deepEqual(
    manifest.cleanup?.pending.map((item) => item.id),
    ["old"],
  );
  assert.deepEqual(client.deletions, []);
  client.delayDeletion = true;
  await Effect.runPromise(cleanup.run(manifest, 1000 + GENERATION_RETENTION_MS));
  assert.deepEqual(client.deletions, [["old"]]);
  assert.equal(manifest.cleanup?.pending.length, 1);
  client.delayDeletion = false;
  await Effect.runPromise(cleanup.run(manifest, 1001 + GENERATION_RETENTION_MS));
  assert.equal(manifest.cleanup?.pending.length, 0);
  assert.equal(client.remote.has("current"), true);
  assert.equal(client.remote.has("foreign"), true);
  assert.equal(client.remote.has("legacy"), true);
  assert.equal(manifest.state, "complete");
  assert.equal((store.entries.get(PUBLICATION_FILE) as PublicationManifest).state, "complete");
});

test("cleanup failure is resumable and never invalidates a verified publication; incomplete generations never delete", async () => {
  const store = new MemoryStore();
  const client = new ControlledClient(config);
  client.remote.set("old", { id: "old", namespace: "old", metadata: { corpus_id: "ours" } });
  const manifest = publication();
  const cleanup = new GenerationCleanup(store, client, messages);
  await Effect.runPromise(cleanup.run(manifest, 0));
  client.failDeletion = true;
  await Effect.runPromise(cleanup.run(manifest, GENERATION_RETENTION_MS));
  assert.equal(manifest.state, "complete");
  assert.equal(manifest.cleanup?.failures.length, 1);
  assert.equal(manifest.cleanup?.pending.length, 1);
  client.failDeletion = false;
  manifest.state = "incomplete";
  await Effect.runPromise(cleanup.run(manifest, GENERATION_RETENTION_MS));
  assert.equal(client.deletions.length, 0);
  manifest.state = "complete";
  await Effect.runPromise(cleanup.run(manifest, GENERATION_RETENTION_MS));
  assert.equal(client.deletions.length, 1);
  assert.equal(manifest.cleanup?.failures.length, 0);
});

test("cleanup rechecks ownership immediately before deletion", async () => {
  const store = new MemoryStore();
  const client = new ControlledClient(config);
  client.remote.set("old", { id: "old", namespace: "old", metadata: { corpus_id: "ours" } });
  const manifest = publication();
  const cleanup = new GenerationCleanup(store, client, messages);
  await Effect.runPromise(cleanup.run(manifest, 0));
  client.remote.set("old", { id: "old", namespace: "old", metadata: { corpus_id: "theirs" } });
  await Effect.runPromise(cleanup.run(manifest, GENERATION_RETENTION_MS));
  assert.equal(client.deletions.length, 0);
  assert.equal(manifest.cleanup?.failures.length, 1);
  assert.equal(manifest.state, "complete");
});
