import { parseArgs } from "node:util";
import { Effect } from "effect";
import { Errors } from "../errors/index.js";
import { discoverInventory } from "../inventory/index.js";
import { inferQuery, IntentLive } from "../intent/index.js";
import { Lexical } from "../lexical/index.js";
import { Messages, type MessageService } from "../messages/index.js";
import { onboard, OnboardingLive } from "../onboarding/index.js";
import { inspectRecords, inspectTaxonomy, inspectValidation } from "../onboarding/inspect.js";
import { TaxonomyLive } from "../taxonomy/governance.js";
import { JevLive } from "../typesafe/client.js";
import { COMMON_OPTIONS, USAGE } from "./consts.js";
import { positiveInteger, selectRoot } from "./utils.js";

export class CliApplication {
  public constructor(private readonly _output: MessageService) {}
  public run(command: string | undefined, args: string[]) {
    return Effect.gen(this, function* () {
      if (command === "onboard") return yield* this._onboard(args);
      if (command === "inspect") return yield* this._inspect(args);
      if (command === "search") return yield* this._search(args);
      if (command === "index" || command === "lexical-search")
        return yield* this._lexical(command === "index" ? "index" : "search", args);
      if (command && command !== "help" && command !== "--help")
        return yield* Errors.fail("INVALID_ARGUMENT", `Unknown command: ${command}`);
      for (const text of USAGE) yield* this._output.report({ label: "Usage", level: "info", text });
      return 0;
    });
  }
  private _onboard(args: string[]) {
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
              "rerun-governance": { type: "boolean" },
            },
          }),
        "INVALID_ARGUMENT",
      );
      const root = yield* Errors.attempt(
        () => selectRoot(positionals, values.root),
        "INVALID_ARGUMENT",
      );
      if (values["dry-run"]) {
        if (values.limit || values["rerun-governance"])
          return yield* Errors.fail(
            "INVALID_ARGUMENT",
            "--limit and --rerun-governance apply to semantic onboarding, not discovery",
          );
        const inventory = yield* discoverInventory(root);
        if (values.json) yield* this._output.json(inventory);
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
      const result = yield* onboard(root, {
        limit,
        rerunGovernance: values["rerun-governance"],
      }).pipe(
        Effect.provide(OnboardingLive),
        Effect.provide(TaxonomyLive),
        Effect.provide(JevLive),
      );
      if (values.json) yield* this._output.json(result.manifest);
      else {
        yield* this._output.report({
          label: "Onboarding",
          level: result.manifest.state === "complete" ? "info" : "warning",
          text: `${result.manifest.state}: ${result.manifest.classified} classified, ${result.manifest.reused} reused, ${result.manifest.failures.length} failures, ${result.manifest.deferred.length} deferred`,
          tags: ["summary"],
        });
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
  private _inspect(args: string[]) {
    return Effect.gen(this, function* () {
      const { values, positionals } = yield* Errors.attempt(
        () => parseArgs({ args, allowPositionals: true, options: COMMON_OPTIONS }),
        "INVALID_ARGUMENT",
      );
      if (
        positionals.length !== 1 ||
        !["records", "taxonomy", "validation"].includes(positionals[0]!)
      )
        return yield* Errors.fail(
          "INVALID_ARGUMENT",
          "Use inspect records|taxonomy|validation --root <path>",
        );
      const result = yield* positionals[0] === "records"
        ? inspectRecords(values.root ?? ".")
        : positionals[0] === "taxonomy"
          ? inspectTaxonomy(values.root ?? ".")
          : inspectValidation(values.root ?? ".");
      if (values.json) yield* this._output.json(result);
      else
        yield* this._output.report({
          label: "Inspection",
          level: "info",
          text: JSON.stringify(result, null, 2),
        });
      return "complete" in result && !result.complete ? 1 : 0;
    });
  }
  private _search(args: string[]) {
    return Effect.gen(this, function* () {
      const { values, positionals } = yield* Errors.attempt(
        () =>
          parseArgs({
            args,
            allowPositionals: true,
            options: { ...COMMON_OPTIONS, "show-intent": { type: "boolean" } },
          }),
        "INVALID_ARGUMENT",
      );
      if (!values["show-intent"])
        return yield* Errors.fail(
          "INVALID_ARGUMENT",
          "Semantic retrieval is not implemented yet; use search --show-intent for query intent or lexical-search for explicit diagnostics.",
        );
      const result = yield* inferQuery(values.root ?? ".", positionals.join(" ")).pipe(
        Effect.provide(IntentLive),
      );
      if (values.json) yield* this._output.json(result);
      else
        yield* this._output.report({
          label: "Query intent",
          level: "info",
          text: JSON.stringify(result, null, 2),
        });
      return 0;
    });
  }
  private _lexical(command: "index" | "search", args: string[]) {
    return Effect.gen(this, function* () {
      const { values, positionals } = yield* Errors.attempt(
        () => parseArgs({ args, allowPositionals: true, options: COMMON_OPTIONS }),
        "INVALID_ARGUMENT",
      );
      const service = yield* Lexical;
      yield* this._output.report({
        label: "Lexical",
        level: "warning",
        text: "Legacy diagnostic only; this is not semantic search.",
      });
      const root = yield* Errors.attempt(
        () => (command === "index" ? selectRoot(positionals, values.root) : (values.root ?? ".")),
        "INVALID_ARGUMENT",
      );
      const result = yield* command === "index"
        ? service.build(root)
        : service.search(positionals.join(" "), root);
      if (values.json) yield* this._output.json(result);
      else
        yield* this._output.report({
          label: "Lexical",
          level: "info",
          text: JSON.stringify(result, null, 2),
        });
      return 0;
    });
  }
}
export const runCli = (command: string | undefined, args: string[]) =>
  Effect.flatMap(Messages, (output) => new CliApplication(output).run(command, args));
