import { randomUUID } from "node:crypto";
import { Context, Effect, Layer } from "effect";
import { Errors } from "../errors/index.js";
import { InventoryServiceTag, type InventoryService } from "../inventory/index.js";
import { Messages, type MessageService } from "../messages/index.js";
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
    private readonly _messages: MessageService,
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
        yield* this._messages.stage("Onboarding", "Loading configuration");
        const settings = yield* this._inventory.configuration(root);
        const configured = settings.config.onboarding;
        const concurrency =
          options.concurrency ?? configured?.concurrency ?? CLASSIFICATION_CONCURRENCY;
        const limit = options.limit ?? configured?.limit;
        const rerunGovernance = options.rerunGovernance ?? configured?.rerunGovernance;
        if (
          !Number.isSafeInteger(concurrency) ||
          concurrency < 1 ||
          (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
        )
          return yield* Errors.fail(
            "INVALID_ARGUMENT",
            "Concurrency and limit must be positive integers",
          );
        mark("configuration");
        yield* this._messages.stage("Onboarding", "Opening local store");
        const runId = randomUUID();
        const store = yield* this._stores.open(root, runId, { resume: options.resume });
        mark("store-open");
        const discovery = yield* this._messages.stage(
          "Onboarding",
          "Discovering and chunking resources",
        );
        const inventory = yield* this._inventory.discover(root, undefined, discovery, store);
        mark("resource-discovery");
        yield* this._messages.stage(
          "Onboarding",
          `Inventory ready — ${inventory.resources.length} resources, ${inventory.chunks.length} chunks discovered`,
        );
        const chunks = inventory.chunks.slice(0, limit);
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
        yield* this._messages.stage("Onboarding", "Saving initial manifest");
        yield* store.write("index.json", manifest);
        mark("manifest-start-write");
        const governance = yield* this._messages.stage(
          "Onboarding",
          "Harvesting taxonomy candidates",
        );
        yield* store.receipt(
          { kind: "run", id: runId },
          {
            type: "started",
            root: inventory.root,
            expected: manifest.expected,
            skipped: inventory.skipped,
          },
        );
        yield* Effect.yieldNow();
        const taxonomy = yield* this._taxonomy.govern(
          inventory,
          store,
          rerunGovernance,
          governance,
        );
        mark("taxonomy-governance");
        yield* this._messages.stage(
          "Onboarding",
          `Processing ${chunks.length} chunks (cached or new; concurrency ${concurrency})`,
        );
        const progress = yield* Effect.acquireRelease(
          Effect.sync(() =>
            this._messages.progress({
              label: "Onboarding chunks",
              total: chunks.length,
              payload: { stage: "classifying" },
            }),
          ),
          (handle) => Effect.sync(() => handle.stop()),
        );
        manifest.taxonomyVersion = taxonomy.version;
        for (const judgment of taxonomy.judgments)
          if (judgment.status === "failed")
            manifest.failures.push({
              subject: `${judgment.dimension}:${judgment.candidateId}`,
              error: judgment.error!,
              details: judgment.errorDetails,
            });
        const resources = new Map(inventory.resources.map((resource) => [resource.id, resource]));
        yield* Effect.forEach(
          chunks,
          (chunk) =>
            Effect.gen(this, function* () {
              const resource = resources.get(chunk.resourceId)!;
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
                progress.increment(1, { stage: reused ? "reused" : "classified" });
              } else {
                const details = Errors.serialize(result.left);
                manifest.failures.push({ subject: chunk.id, error: details.message, details });
                yield* store.receipt(
                  { kind: "chunk", id: chunk.id },
                  { type: "classification-failed", error: details },
                );
                progress.increment(1, { stage: "failed" });
              }
            }),
          { concurrency, discard: true },
        );
        mark("chunk-classification");
        yield* this._messages.stage("Onboarding", "Saving final manifest");
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
      yield* Messages,
      yield* Jev,
    );
  }),
);
export const onboard = (root: string, options: OnboardOptions = {}) =>
  Effect.flatMap(Onboarding, (service) => service.onboard(root, options));
