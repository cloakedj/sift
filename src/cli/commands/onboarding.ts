import { parseArgs } from "node:util";
import { Effect } from "effect";
import { Errors } from "../../errors/index.js";
import { discoverInventory } from "../../inventory/index.js";
import { onboard, OnboardingLive } from "../../onboarding/index.js";
import { TaxonomyLive } from "../../taxonomy/governance.js";
import { JevLive } from "../../typesafe/client.js";
import { COMMON_OPTIONS } from "../consts.js";
import { positiveInteger, selectRoot } from "../utils.js";
import { CorpusCommand } from "./base.js";

export class OnboardingCommand extends CorpusCommand {
  /**
   * Dry runs only inventory sources; semantic onboarding acquires scoped progress
   * and inference services. Both paths preserve incomplete-run exit status.
   */
  public run(args: string[]) {
    return Effect.gen(this, function* () {
      const { values, positionals } = yield* Errors.attempt(
        () =>
          parseArgs({
            args,
            allowPositionals: true,
            options: {
              ...COMMON_OPTIONS,
              "dry-run": { type: "boolean" },
              limit: { type: "string" },
              concurrency: { type: "string" },
              "rerun-governance": { type: "boolean" },
              "no-rerun-governance": { type: "boolean" },
              resume: { type: "boolean" },
            },
          }),
        "INVALID_ARGUMENT",
      );
      const root = yield* Errors.attempt(
        () => selectRoot(positionals, values.root),
        "INVALID_ARGUMENT",
      );
      if (values["rerun-governance"] && values["no-rerun-governance"])
        return yield* Errors.fail("INVALID_ARGUMENT", "Choose only one governance override");
      if (values["dry-run"]) {
        if (
          values.limit ||
          values.concurrency ||
          values["rerun-governance"] ||
          values["no-rerun-governance"] ||
          values.resume
        )
          return yield* Errors.fail(
            "INVALID_ARGUMENT",
            "Classification, governance, and recovery flags apply to semantic onboarding, not discovery",
          );
        yield* this._reportCorpus(values.json);
        const inventory = yield* Effect.scoped(
          Effect.gen(this, function* () {
            const activity = yield* this._output.stage(
              "Onboarding",
              "Discovering and chunking resources (dry run)",
            );
            return yield* discoverInventory(root, undefined, activity);
          }),
        );
        if (values.json) yield* this._json(inventory);
        else {
          yield* this._output.report({
            label: "Inventory",
            level: "info",
            text: `${inventory.resources.length} resources, ${inventory.chunks.length} chunks`,
            tags: ["summary"],
          });
          for (const resource of inventory.resources)
            yield* this._output.report({
              label: "Resource",
              level: "info",
              text: `${resource.path}: ${resource.chunkCount} chunks (${resource.bytes} bytes)`,
            });
          for (const chunk of inventory.chunks)
            yield* this._output.report({
              label: "Chunk",
              level: "info",
              text: `${chunk.path}:${chunk.startLine}-${chunk.endLine} bytes=${chunk.startByte}-${chunk.endByte} id=${chunk.id}`,
            });
          for (const item of inventory.skipped)
            yield* this._output.report({
              label: "Discovery",
              level: "warning",
              text: `Skipped ${item.path}: ${item.reason}`,
            });
          for (const item of inventory.failures)
            yield* this._output.error(
              "Discovery",
              item.details ? Errors.restore(item.details) : Errors.create("IO", item.error),
            );
          yield* this._output.report({
            label: "Onboarding",
            level: "info",
            text: "Dry run: no inference calls, local writes, or publication.",
          });
        }
        return inventory.complete ? 0 : 1;
      }
      const limit =
        values.limit === undefined
          ? undefined
          : yield* Errors.attempt(() => positiveInteger(values.limit, 1), "INVALID_ARGUMENT");
      yield* this._reportCorpus(values.json);
      const result = yield* Effect.scoped(
        Effect.gen(this, function* () {
          yield* this._output.stage("Onboarding", "Initializing inference provider");
          return yield* onboard(root, {
            limit,
            concurrency:
              values.concurrency === undefined
                ? undefined
                : yield* Errors.attempt(
                    () => positiveInteger(values.concurrency, 1),
                    "INVALID_ARGUMENT",
                  ),
            rerunGovernance: values["no-rerun-governance"] ? false : values["rerun-governance"],
            resume: values.resume,
          }).pipe(
            Effect.provide(OnboardingLive),
            Effect.provide(TaxonomyLive),
            Effect.provide(JevLive),
          );
        }),
      );
      if (values.json) yield* this._json(result.manifest);
      else {
        yield* this._output.report({
          label: "Onboarding",
          level: result.manifest.state === "complete" ? "info" : "warning",
          text: `${result.manifest.state}: ${result.manifest.classified} classified, ${result.manifest.reused} reused, ${result.manifest.failures.length} failures, ${result.manifest.deferred.length} deferred`,
          tags: ["summary"],
        });
        yield* this._output.table(
          { label: "Onboarding", level: "info", tags: ["timing"] },
          {
            columns: [{ heading: "Stage" }, { heading: "Duration (ms)", align: "right" }],
            rows: result.timings.map((timing) => [timing.stage, timing.milliseconds.toFixed(1)]),
          },
        );
        for (const failure of result.manifest.failures)
          yield* this._output.error(
            "Jev",
            failure.details
              ? Errors.restore(failure.details)
              : Errors.create("PROVIDER", failure.error),
          );
        for (const warning of result.taxonomy.harvest.warnings)
          yield* this._output.report({
            label: "Taxonomy",
            level: "warning",
            text: `${warning.path}: ${warning.message}`,
            error: warning.details,
          });
      }
      return result.manifest.state === "complete" ? 0 : 1;
    });
  }
}
