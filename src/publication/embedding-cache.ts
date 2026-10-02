import { Effect } from "effect";
import { Errors } from "../errors/index.js";
import type { LocalStore } from "../onboarding/types.js";
import type { CloudflarePublicationClient } from "./client.js";
import type { EmbeddingCacheEntry } from "./types.js";
import { embeddingCacheKey, validEmbedding } from "./utils.js";

export class EmbeddingCache {
  public constructor(
    private readonly _store: LocalStore,
    private readonly _client: CloudflarePublicationClient,
    private readonly _model: string,
  ) {}

  /**
   * Cache exact inputs independently of generation and deduplicate within a batch.
   * Import validated legacy generation caches without another provider call.
   * Persist each inferred batch before any remote vector mutation.
   */
  public load(documents: string[], legacy?: number[][]) {
    return Effect.gen(this, function* () {
      const keys = documents.map((document) => embeddingCacheKey(document, this._model));
      const values = new Map<string, number[]>();
      const missing = new Map<string, string>();
      for (let index = 0; index < documents.length; index++) {
        const key = keys[index]!;
        if (values.has(key) || missing.has(key)) continue;
        const path = `embedding-${key}.json`;
        const cached = yield* this._store.read<EmbeddingCacheEntry>(path);
        if (cached && (cached.key !== key || !validEmbedding(cached.values)))
          return yield* Errors.fail("INVALID_DATA", "Invalid cached embedding", { path });
        const vector = cached?.values ?? legacy?.[index];
        if (vector) {
          if (!validEmbedding(vector))
            return yield* Errors.fail("INVALID_DATA", "Invalid legacy cached embedding", { path });
          values.set(key, vector);
          if (!cached) yield* this._store.write(path, { key, values: vector });
        } else missing.set(key, documents[index]!);
      }
      if (missing.size) {
        const inferred = yield* this._client.embed([...missing.values()]);
        let index = 0;
        for (const key of missing.keys()) {
          const vector = inferred[index++]!;
          yield* this._store.write(`embedding-${key}.json`, { key, values: vector });
          values.set(key, vector);
        }
      }
      return keys.map((key) => values.get(key)!);
    });
  }
}
