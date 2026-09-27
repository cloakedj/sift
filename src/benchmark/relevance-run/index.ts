import { resolve } from "node:path";
import { Effect, Either } from "effect";
import { Errors } from "../../errors/index.js";
import { FileSystem, type FileSystemService } from "../../filesystem/index.js";
import { InventoryServiceTag, type InventoryService } from "../../inventory/index.js";
import { Retrieval } from "../../retrieval/index.js";
import { MAX_QUERY_TOP_K } from "../../publication/consts.js";
import { MAX_CANDIDATES } from "../../retrieval/reranking/consts.js";
import { hash } from "../../shared/utils.js";
import { evaluateRelevance } from "../relevance/index.js";
import type { RelevanceCase } from "../relevance/types.js";
import type { BenchmarkSearch, RelevanceRunOptions, RelevanceRunReport } from "./types.js";
import { parseSuite, resolveLabels } from "./utils.js";

export class RelevanceRunService {
  public constructor(
    private readonly _fs: Pick<FileSystemService, "readJson">,
    private readonly _inventory: Pick<InventoryService, "discover">,
    private readonly _retrieval: BenchmarkSearch,
  ) {}

  /**
   * Preflight every corpus before paid work, then search sequentially so cost and
   * failures stay attributable to individual cases. Preserve typed failures, but
   * let interruption cancel the run. Metrics require all cases and final source
   * checks to succeed; a provider failure never becomes a correct abstention.
   */
  public run(suitePath: string, root: string, options: RelevanceRunOptions) {
    return Effect.gen(this, function* () {
      if (
        !Number.isSafeInteger(options.topK) ||
        options.topK < 1 ||
        options.topK > (options.rerank ? MAX_CANDIDATES : MAX_QUERY_TOP_K) ||
        !["answer-if-any", "rerank-min-relevance"].includes(options.policy) ||
        (options.policy === "rerank-min-relevance" &&
          (!options.rerank ||
            typeof options.minRelevance !== "number" ||
            !Number.isFinite(options.minRelevance) ||
            options.minRelevance < 0 ||
            options.minRelevance > 1))
      )
        return yield* Errors.fail(
          "INVALID_ARGUMENT",
          "Use answer-if-any policy, or rerank-min-relevance with --rerank and --min-relevance 0..1; top-k 1–50 (1–8 with reranking)",
        );
      const startedAt = new Date().toISOString();
      const raw = yield* this._fs.readJson<unknown>(suitePath);
      if (raw === undefined)
        return yield* Errors.fail("NOT_FOUND", "Relevance suite file not found");
      const suite = yield* Errors.attempt(() => parseSuite(raw), "INVALID_DATA");
      const prepared = yield* Effect.forEach(suite.corpora, (corpus) =>
        Effect.gen(this, function* () {
          const corpusRoot = resolve(root, corpus.scope);
          const inventory = yield* this._inventory.discover(corpusRoot);
          const labels = yield* Errors.attempt(
            () => resolveLabels(corpus, inventory),
            "INVALID_DATA",
          );
          return { corpus, root: corpusRoot, labels };
        }),
      );
      const outcomes: RelevanceRunReport["outcomes"] = [];
      const currencyFailures: RelevanceRunReport["currencyFailures"] = [];
      for (const preparedCorpus of prepared) {
        const { corpus, root: corpusRoot, labels } = preparedCorpus;
        const allowed = new Set(labels.values());
        let generation: string | undefined;
        for (const item of corpus.cases) {
          const outcome = yield* Effect.gen(this, function* () {
            const search = yield* this._retrieval.search(corpusRoot, item.query, {
              topK: options.topK,
              rerank: options.rerank,
              explain: true,
              lexicalFallback: false,
            });
            if (
              search.root !== corpusRoot ||
              search.query !== item.query ||
              search.ranking !== (options.rerank ? "jev-relevance" : "vector") ||
              search.results.length > options.topK ||
              search.results.some(
                (result) => !allowed.has(result.record.id) || result.source === "lexical-fallback",
              )
            )
              return yield* Errors.fail(
                "INVALID_DATA",
                "Search observation does not match benchmark corpus or mode",
              );
            if (generation !== undefined && generation !== search.publication.fingerprint)
              return yield* Errors.fail(
                "INCOMPLETE",
                "Publication generation changed during benchmark corpus run",
              );
            generation = search.publication.fingerprint;
            if (
              options.policy === "rerank-min-relevance" &&
              search.results.some((result) => result.relevance === undefined)
            )
              return yield* Errors.fail(
                "INVALID_DATA",
                "Threshold answer policy requires reranked relevance judgments on every result",
              );
            const answered =
              options.policy === "answer-if-any"
                ? search.results.length > 0
                : (search.results[0]?.relevance?.score ?? -1) >= options.minRelevance!;
            const evaluation: RelevanceCase = {
              id: item.id,
              relevantIds: item.relevant.map((key) => labels.get(key)!),
              retrievedIds: search.results.map((result) => result.record.id),
              answered,
            };
            yield* evaluateRelevance([evaluation], options.topK);
            return { state: "succeeded" as const, evaluation, search };
          }).pipe(Effect.either);
          outcomes.push({
            id: item.id,
            scope: corpus.scope,
            query: item.query,
            ...(Either.isRight(outcome)
              ? outcome.right
              : { state: "failed" as const, error: Errors.serialize(outcome.left) }),
          });
        }
      }
      for (const { corpus, root: corpusRoot } of prepared) {
        const current = yield* this._inventory.discover(corpusRoot).pipe(
          Effect.flatMap((inventory) =>
            Errors.attempt(() => resolveLabels(corpus, inventory), "INVALID_DATA"),
          ),
          Effect.either,
        );
        if (Either.isLeft(current))
          currencyFailures.push({ scope: corpus.scope, error: Errors.serialize(current.left) });
      }
      const complete =
        !currencyFailures.length && outcomes.every((outcome) => outcome.state === "succeeded");
      const metrics = complete
        ? yield* evaluateRelevance(
            outcomes.flatMap((outcome) =>
              outcome.state === "succeeded" ? [outcome.evaluation] : [],
            ),
            options.topK,
          )
        : null;
      return {
        schemaVersion: 1,
        suiteHash: hash(JSON.stringify(suite)),
        startedAt,
        finishedAt: new Date().toISOString(),
        options: { ...options },
        policyKind:
          options.policy === "answer-if-any"
            ? "hypothetical-baseline"
            : "explicit-threshold-experiment",
        complete,
        outcomes,
        currencyFailures,
        metrics,
      } satisfies RelevanceRunReport;
    });
  }
}

export const runRelevanceSuite = (suitePath: string, root: string, options: RelevanceRunOptions) =>
  Effect.gen(function* () {
    const service = new RelevanceRunService(
      yield* FileSystem,
      yield* InventoryServiceTag,
      yield* Retrieval,
    );
    return yield* service.run(suitePath, root, options);
  });
