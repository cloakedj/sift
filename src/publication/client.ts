import { Effect, Schedule } from "effect";
import { Errors } from "../errors/index.js";
import { GET_VECTOR_BATCH_SIZE, MAX_QUERY_TOP_K } from "./consts.js";
import type { CloudflareConfig, EmbeddingVector, RemoteVector, VectorMatch } from "./types.js";

export class CloudflarePublicationClient {
  public constructor(private readonly _config: CloudflareConfig) {}

  public embed(texts: string[]) {
    return Effect.gen(this, function* () {
      const body = yield* this._request(`/ai/run/${this._config.model}`, {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: texts, pooling: "cls" }),
      });
      const result = body as { data?: unknown; pooling?: unknown };
      const vectors = result?.data;
      if (
        result?.pooling !== "cls" ||
        !Array.isArray(vectors) ||
        vectors.length !== texts.length ||
        vectors.some(
          (values) =>
            !Array.isArray(values) ||
            values.length !== 768 ||
            !values.every((value) => typeof value === "number" && Number.isFinite(value)) ||
            !values.some((value) => value !== 0),
        )
      )
        return yield* Errors.fail(
          "CLOUDFLARE_RESPONSE",
          "Invalid embedding dimensions, pooling, or values",
        );
      return vectors as number[][];
    });
  }

  public upsert(vectors: EmbeddingVector[]) {
    return Effect.gen(this, function* () {
      const form = new FormData();
      form.set(
        "vectors",
        new Blob([vectors.map((vector) => JSON.stringify(vector)).join("\n") + "\n"], {
          type: "application/x-ndjson",
        }),
        "vectors.ndjson",
      );
      const body = yield* this._request(
        `/vectorize/v2/indexes/${encodeURIComponent(this._config.vectorizeIndex)}/upsert`,
        { body: form },
      );
      const mutation = (body as { mutationId?: unknown })?.mutationId;
      if (typeof mutation !== "string" || !mutation)
        return yield* Errors.fail(
          "CLOUDFLARE_RESPONSE",
          "Vectorize did not return a mutation identifier",
        );
      return mutation;
    });
  }

  public getVectors(ids: string[]) {
    return Effect.gen(this, function* () {
      if (!ids.length) return [] as RemoteVector[];
      if (ids.length > GET_VECTOR_BATCH_SIZE)
        return yield* Errors.fail("PAYLOAD_LIMIT", "Vectorize get batch exceeds 20 IDs");
      const result = yield* this._request(
        `/vectorize/v2/indexes/${encodeURIComponent(this._config.vectorizeIndex)}/get_by_ids`,
        {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids }),
        },
      );
      if (
        !Array.isArray(result) ||
        result.some(
          (item) =>
            !item ||
            typeof item.id !== "string" ||
            !ids.includes(item.id) ||
            (item.namespace !== undefined && typeof item.namespace !== "string"),
        )
      )
        return yield* Errors.fail("CLOUDFLARE_RESPONSE", "Invalid Vectorize get response");
      return result.map((item): RemoteVector => ({
        id: item.id,
        namespace: item.namespace ?? "",
        metadata: item.metadata && typeof item.metadata === "object" ? item.metadata : {},
      }));
    });
  }

  /**
   * Enumerate a bounded shared-index snapshot without assuming ownership. Listing
   * is eventually consistent; callers combine it with direct gets of expected IDs.
   */
  public listVectors() {
    return Effect.gen(this, function* () {
      const ids = new Set<string>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 100; page++) {
        const query = new URLSearchParams({ count: "1000", ...(cursor ? { cursor } : {}) });
        const body = yield* this._request(
          `/vectorize/v2/indexes/${encodeURIComponent(this._config.vectorizeIndex)}/list?${query}`,
          { method: "GET" },
        );
        const result = body as {
          vectors?: { id?: unknown }[];
          isTruncated?: unknown;
          nextCursor?: unknown;
        };
        if (
          !Array.isArray(result?.vectors) ||
          result.vectors.some((vector) => typeof vector?.id !== "string") ||
          typeof result.isTruncated !== "boolean"
        )
          return yield* Errors.fail("CLOUDFLARE_RESPONSE", "Invalid Vectorize listing response");
        for (const vector of result.vectors) ids.add(vector.id as string);
        if (!result.isTruncated) return [...ids];
        if (
          typeof result.nextCursor !== "string" ||
          !result.nextCursor ||
          cursors.has(result.nextCursor)
        )
          return yield* Errors.fail(
            "CLOUDFLARE_RESPONSE",
            "Invalid or repeated Vectorize listing cursor",
          );
        cursor = result.nextCursor;
        cursors.add(cursor);
      }
      return yield* Errors.fail(
        "PAYLOAD_LIMIT",
        "Vectorize reconciliation exceeds 100 listing pages",
      );
    });
  }

  public query(vector: number[], namespace: string, topK: number) {
    return Effect.gen(this, function* () {
      if (
        vector.length !== 768 ||
        !vector.every((value) => Number.isFinite(value)) ||
        !vector.some((value) => value !== 0)
      )
        return yield* Errors.fail("INVALID_ARGUMENT", "Query vector must have 768 finite values");
      if (!Number.isInteger(topK) || topK < 1 || topK > MAX_QUERY_TOP_K)
        return yield* Errors.fail("INVALID_ARGUMENT", "Query topK must be between 1 and 50");
      const result = yield* this._request(
        `/vectorize/v2/indexes/${encodeURIComponent(this._config.vectorizeIndex)}/query`,
        {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            vector,
            namespace,
            topK,
            returnMetadata: "all",
            returnValues: false,
          }),
        },
      );
      const matches = (result as { matches?: unknown })?.matches;
      if (
        !Array.isArray(matches) ||
        matches.length > topK ||
        matches.some(
          (match) =>
            !match ||
            typeof match.id !== "string" ||
            typeof match.score !== "number" ||
            !Number.isFinite(match.score) ||
            (match.namespace !== undefined && typeof match.namespace !== "string") ||
            (match.metadata !== undefined &&
              (typeof match.metadata !== "object" || match.metadata === null)),
        )
      )
        return yield* Errors.fail("CLOUDFLARE_RESPONSE", "Invalid Vectorize query response");
      return matches.map((match): VectorMatch => ({
        id: match.id,
        namespace: match.namespace ?? "",
        score: match.score,
        metadata: match.metadata && typeof match.metadata === "object" ? match.metadata : {},
      }));
    });
  }

  public verifyIndex() {
    return Effect.gen(this, function* () {
      const result = yield* this._request(
        `/vectorize/v2/indexes/${encodeURIComponent(this._config.vectorizeIndex)}`,
        { method: "GET" },
      );
      const config = (result as { config?: { dimensions?: unknown; metric?: unknown } })?.config;
      if (config?.dimensions !== 768 || config?.metric !== "cosine")
        return yield* Errors.fail(
          "CONFIGURATION",
          "Vectorize index must use 768 dimensions and cosine distance",
        );
    });
  }

  /**
   * Query visibility is stronger than mutation acceptance; unknown IDs never count.
   * Self-query top-100 is conservative: large identical-vector groups can remain
   * pending even when stored, rather than falsely proving complete visibility.
   */
  public visible(vector: EmbeddingVector) {
    return Effect.gen(this, function* () {
      const result = yield* this._request(
        `/vectorize/v2/indexes/${encodeURIComponent(this._config.vectorizeIndex)}/query`,
        {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            vector: vector.values,
            namespace: vector.namespace,
            topK: 100,
            returnMetadata: "none",
            returnValues: false,
          }),
        },
      );
      const matches = (result as { matches?: unknown })?.matches;
      if (
        !Array.isArray(matches) ||
        matches.some(
          (match) =>
            !match ||
            typeof match.id !== "string" ||
            typeof match.score !== "number" ||
            !Number.isFinite(match.score),
        )
      )
        return yield* Errors.fail("CLOUDFLARE_RESPONSE", "Invalid Vectorize query response");
      return matches.some(
        (match) => match.id === vector.id && match.namespace === vector.namespace,
      );
    });
  }

  private _request(path: string, init: RequestInit) {
    return Effect.gen(this, function* () {
      const response = yield* Errors.async(
        (signal) =>
          fetch(
            `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this._config.accountId)}${path}`,
            {
              ...init,
              method: init.method ?? "POST",
              signal,
              headers: { ...init.headers, authorization: `Bearer ${this._config.apiToken}` },
            },
          ),
        "CLOUDFLARE_TRANSIENT",
      );
      if (!response.ok)
        return yield* Errors.fail(
          response.status === 408 || response.status === 429 || response.status >= 500
            ? "CLOUDFLARE_TRANSIENT"
            : "CLOUDFLARE",
          "Cloudflare request failed",
          {
            status: response.status,
          },
        );
      const body = yield* Errors.async(() => response.json(), "CLOUDFLARE_RESPONSE");
      if (
        !body ||
        typeof body !== "object" ||
        !("success" in body) ||
        body.success !== true ||
        !("result" in body) ||
        !body.result
      )
        return yield* Errors.fail(
          "CLOUDFLARE_RESPONSE",
          "Cloudflare returned an unsuccessful response",
        );
      return body.result as unknown;
    }).pipe(
      Effect.timeoutFail({
        duration: "60 seconds",
        onTimeout: () => Errors.create("CLOUDFLARE_TRANSIENT", "Cloudflare request timed out"),
      }),
      Effect.retry({
        times: 2,
        schedule: Schedule.exponential("250 millis"),
        while: (error) => error.retryable,
      }),
    );
  }
}
