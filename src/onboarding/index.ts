import { randomUUID } from "node:crypto";
import { Context, Effect, Layer } from "effect";
import { Errors } from "../errors/index.js";
import { InventoryServiceTag, type InventoryService } from "../inventory/index.js";
import { Taxonomy, type TaxonomyService } from "../taxonomy/governance.js";
import { Jev, type JevService } from "../typesafe/client.js";
import { ClassificationService } from "./classify.js";
import { CLASSIFICATION_CONCURRENCY } from "./consts.js";
import { Stores, type StoreService } from "./store.js";
import type { OnboardOptions, OnboardResult, RunManifest } from "./types.js";

export class OnboardingService {
  private readonly _classifier: ClassificationService;
  public constructor(
    private readonly _inventory: InventoryService,
    private readonly _stores: StoreService,
    private readonly _taxonomy: TaxonomyService,
    jev: JevService,
  ) {
    this._classifier = new ClassificationService(jev);
  }

  /**
   * Govern candidates and classify chunks in a resumable, single-writer run.
   * Record partial progress and explicit failures instead of substituting lexical results.
   */
  public onboard(root: string, options: OnboardOptions = {}) {
    return Effect.scoped(
      Effect.gen(this, function* () {
        const timings: OnboardResult["timings"] = [];
        const onboardStarted = performance.now();
        let stageStarted = onboardStarted;
        const mark = (stage: string) => {
          const now = performance.now();
          timings.push({ stage, milliseconds: now - stageStarted });
          stageStarted = now;
        };
        const concurrency = options.concurrency ?? CLASSIFICATION_CONCURRENCY;
        if (
          !Number.isSafeInteger(concurrency) ||
          concurrency < 1 ||
          (options.limit !== undefined &&
            (!Number.isSafeInteger(options.limit) || options.limit < 1))
        )
          return yield* Errors.fail(
            "INVALID_ARGUMENT",
            "Concurrency and limit must be positive integers",
          );
        mark("configuration");
        const inventory = yield* this._inventory.discover(root);
        mark("resource-discovery");
        const runId = randomUUID();
        const store = yield* this._stores.open(root, runId);
        mark("store-open");
        const chunks = inventory.chunks.slice(0, options.limit);
        const manifest: RunManifest = {
          schemaVersion: 2,
          runId,
          root: inventory.root,
          state: "running",
          expected: inventory.chunks.length,
          records: [],
          failures: inventory.failures.map((failure) => ({
            subject: failure.path,
            error: failure.error,
            details: failure.details,
          })),
          deferred: inventory.chunks.slice(chunks.length).map((chunk) => chunk.id),
          reused: 0,
          classified: 0,
          startedAt: new Date().toISOString(),
        };
        yield* store.write("index.json", manifest);
        mark("manifest-start-write");
        yield* store.receipt(
          { kind: "run", id: runId },
          {
            type: "started",
            root: inventory.root,
            expected: manifest.expected,
            skipped: inventory.skipped,
          },
        );
        const taxonomy = yield* this._taxonomy.govern(inventory, store, options.rerunGovernance);
        mark("taxonomy-governance");
        manifest.taxonomyVersion = taxonomy.version;
        for (const judgment of taxonomy.judgments)
          if (judgment.status === "failed")
            manifest.failures.push({
              subject: `${judgment.dimension}:${judgment.candidateId}`,
              error: judgment.error!,
              details: judgment.errorDetails,
            });
        yield* Effect.forEach(
          chunks,
          (chunk) =>
            Effect.gen(this, function* () {
              const resource = inventory.resources.find(
                (resource) => resource.id === chunk.resourceId,
              )!;
              const result = yield* Effect.either(
                this._classifier.classify(chunk, resource, taxonomy, store, runId),
              );
              if (result._tag === "Right") {
                const { record, reused } = result.right;
                manifest.records.push({
                  id: record.id,
                  resourceHash: record.resource.resourceHash,
                  fingerprint: record.classificationFingerprint,
                });
                if (reused) manifest.reused++;
                else manifest.classified++;
              } else {
                const details = Errors.serialize(result.left);
                manifest.failures.push({ subject: chunk.id, error: details.message, details });
                yield* store.receipt(
                  { kind: "chunk", id: chunk.id },
                  { type: "classification-failed", error: details },
                );
              }
            }),
          { concurrency, discard: true },
        );
        mark("chunk-classification");
        manifest.records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        manifest.state =
          manifest.failures.length || manifest.deferred.length ? "incomplete" : "complete";
        manifest.finishedAt = new Date().toISOString();
        yield* store.receipt(
          { kind: "run", id: runId },
          {
            type: "finished",
            state: manifest.state,
            classified: manifest.classified,
            reused: manifest.reused,
            failed: manifest.failures.length,
            deferred: manifest.deferred.length,
          },
        );
        yield* store.write("index.json", manifest);
        mark("manifest-finish-write");
        timings.push({ stage: "end-to-end", milliseconds: performance.now() - onboardStarted });
        return { manifest, taxonomy, timings } satisfies OnboardResult;
      }),
    );
  }
}
export class Onboarding extends Context.Tag("Onboarding")<Onboarding, OnboardingService>() {}
export const OnboardingLive = Layer.effect(
  Onboarding,
  Effect.gen(function* () {
    return new OnboardingService(
      yield* InventoryServiceTag,
      yield* Stores,
      yield* Taxonomy,
      yield* Jev,
    );
  }),
);
export const onboard = (root: string, options: OnboardOptions = {}) =>
  Effect.flatMap(Onboarding, (service) => service.onboard(root, options));
