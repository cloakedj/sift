import { parseArgs } from "node:util";
import { Effect } from "effect";
import {
  evaluateRelevanceFile,
  generateScaleCorpus,
  summarizeBenchmarkReportFiles,
} from "../benchmark/index.js";
import type { ScaleCorpusKind } from "../benchmark/types.js";
import { runRelevanceSuite } from "../benchmark/relevance-run/index.js";
import { Errors } from "../errors/index.js";
import { discoverInventory } from "../inventory/index.js";
import { inferQuery, IntentLive } from "../intent/index.js";
import { Lexical } from "../lexical/index.js";
import { Messages, type MessageService } from "../messages/index.js";
import { onboard, OnboardingLive } from "../onboarding/index.js";
import {
  inspectRecords,
  inspectTaxonomy,
  inspectValidation,
  repairProjections,
} from "../onboarding/inspect.js";
import { publicationStatus, publishVectors, PublicationLive } from "../publication/index.js";
import { searchSemantic, RetrievalLive } from "../retrieval/index.js";
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
      if (command === "repair-projections") return yield* this._repairProjections(args);
      if (command === "publish") return yield* this._publish(args);
      if (command === "status") return yield* this._status(args);
      if (command === "generate-scale-corpus") return yield* this._generateScaleCorpus(args);
      if (command === "benchmark-summary") return yield* this._benchmarkSummary(args);
      if (command === "evaluate-relevance") return yield* this._evaluateRelevance(args);
      if (command === "benchmark-relevance") return yield* this._benchmarkRelevance(args);
      if (command === "index" || command === "lexical-search")
        return yield* this._lexical(command === "index" ? "index" : "search", args);
      if (command && command !== "help" && command !== "--help")
        return yield* Errors.fail("INVALID_ARGUMENT", `Unknown command: ${command}`);
      for (const text of USAGE) yield* this._output.report({ label: "Usage", level: "info", text });
      return 0;
    });
  }
  /**
   * Parse onboarding options and run discovery or paid semantic classification.
   */
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
            options: {
              ...COMMON_OPTIONS,
              "show-intent": { type: "boolean" },
              "min-relevance": { type: "string" },
              explain: { type: "boolean" },
              rerank: { type: "boolean" },
              "semantic-only": { type: "boolean" },
              anchor: { type: "string", multiple: true },
              "top-k": { type: "string" },
            },
          }),
        "INVALID_ARGUMENT",
      );
      if (
        values["show-intent"] &&
        (values.explain ||
          values["top-k"] ||
          values.rerank ||
          values["semantic-only"] ||
          values.anchor ||
          values["min-relevance"] !== undefined)
      )
        return yield* Errors.fail(
          "INVALID_ARGUMENT",
          "--explain, --top-k, --rerank, --min-relevance, --semantic-only and --anchor require retrieval, not --show-intent",
        );
      const topK =
        values["top-k"] === undefined
          ? undefined
          : yield* Errors.attempt(() => positiveInteger(values["top-k"], 8), "INVALID_ARGUMENT");
      const result = yield* Effect.scoped(
        Effect.gen(this, function* () {
          yield* this._output.activity(
            values["show-intent"] ? "Inferring query intent" : "Searching semantic index",
          );
          return yield* values["show-intent"]
            ? inferQuery(values.root ?? ".", positionals.join(" ")).pipe(Effect.provide(IntentLive))
            : searchSemantic(values.root ?? ".", positionals.join(" "), {
                explain: values.explain,
                discovery: values["semantic-only"] ? "semantic" : "hybrid",
                anchors: values.anchor?.map((value) => ({ kind: "literal" as const, value })),
                rerank: values.rerank,
                minRelevance:
                  values["min-relevance"] === undefined
                    ? undefined
                    : values["min-relevance"].trim() === ""
                      ? NaN
                      : Number(values["min-relevance"]),
                topK,
              }).pipe(
                Effect.provide(RetrievalLive),
                Effect.provide(IntentLive),
                Effect.provide(PublicationLive),
              );
        }),
      );
      if (values.json) yield* this._output.json(result);
      else if ("results" in result && !values.explain) {
        for (const match of result.results) {
          yield* this._output.report({
            label: "Search",
            level: "info",
            text: `${match.rank}. [${match.source ?? "semantic"}] ${match.record.resource.structure?.label ?? match.record.resource.structure?.symbol ?? ""} ${match.record.resource.uri}:${match.record.resource.range.startLine}-${match.record.resource.range.endLine}\n${match.record.resource.textPreview}`,
          });
          for (const context of match.context ?? [])
            yield* this._output.report({
              label: "Search",
              level: "info",
              tags: ["supporting-context", context.relation],
              text: `${context.record.resource.structure?.label ?? context.record.resource.structure?.symbol ?? ""} ${context.record.resource.uri}:${context.record.resource.range.startLine}-${context.record.resource.range.endLine}\n${context.record.resource.textPreview}`,
            });
        }
        for (const finding of result.findings)
          yield* this._output.report({
            label: "Search",
            level: finding.severity,
            text: finding.message,
          });
      } else
        yield* this._output.report({
          label: values["show-intent"] ? "Query intent" : "Search",
          level: "info",
          text: JSON.stringify(result, null, 2),
        });
      return 0;
    });
  }
  private _repairProjections(args: string[]) {
    return Effect.gen(this, function* () {
      const { values, positionals } = yield* Errors.attempt(
        () => parseArgs({ args, allowPositionals: true, options: COMMON_OPTIONS }),
        "INVALID_ARGUMENT",
      );
      if (positionals.length)
        return yield* Errors.fail("INVALID_ARGUMENT", "Use repair-projections --root <path>");
      const result = yield* repairProjections(values.root ?? ".");
      if (values.json) yield* this._output.json(result);
      else
        yield* this._output.report({
          label: "Projection",
          level: "info",
          text: `${result.repaired} repaired, ${result.unchanged} unchanged (${result.projectionVersion})`,
          tags: ["summary"],
        });
      return 0;
    });
  }
  private _publish(args: string[]) {
    return Effect.gen(this, function* () {
      const { values, positionals } = yield* Errors.attempt(
        () => parseArgs({ args, allowPositionals: true, options: COMMON_OPTIONS }),
        "INVALID_ARGUMENT",
      );
      if (positionals.length)
        return yield* Errors.fail("INVALID_ARGUMENT", "Use publish --root <path>");
      const result = yield* publishVectors(values.root ?? ".").pipe(
        Effect.provide(PublicationLive),
      );
      if (values.json) yield* this._output.json(result);
      else
        yield* this._output.report({
          label: "Publication",
          level: result.state === "complete" ? "info" : "warning",
          text: `${result.state}: ${result.published.length}/${result.expected} submitted, ${result.visible.length} query-visible in ${result.vectorBackend.index}`,
          tags: ["summary"],
        });
      return result.state === "complete" ? 0 : 1;
    });
  }
  private _status(args: string[]) {
    return Effect.gen(this, function* () {
      const { values, positionals } = yield* Errors.attempt(
        () => parseArgs({ args, allowPositionals: true, options: COMMON_OPTIONS }),
        "INVALID_ARGUMENT",
      );
      if (positionals.length)
        return yield* Errors.fail("INVALID_ARGUMENT", "Use status --root <path>");
      const result = yield* publicationStatus(values.root ?? ".").pipe(
        Effect.provide(PublicationLive),
      );
      if (values.json) yield* this._output.json(result);
      else
        yield* this._output.report({
          label: "Status",
          level: result.complete ? "info" : "warning",
          text: JSON.stringify(result, null, 2),
        });
      return result.complete ? 0 : 1;
    });
  }
  private _generateScaleCorpus(args: string[]) {
    return Effect.gen(this, function* () {
      const { values, positionals } = yield* Errors.attempt(
        () =>
          parseArgs({
            args,
            allowPositionals: true,
            options: {
              ...COMMON_OPTIONS,
              chunks: { type: "string" },
              kind: { type: "string" },
            },
          }),
        "INVALID_ARGUMENT",
      );
      if (positionals.length)
        return yield* Errors.fail(
          "INVALID_ARGUMENT",
          "Use generate-scale-corpus --root <path> --chunks <n> [--kind code|text|mixed]",
        );
      const chunks = yield* Errors.attempt(
        () => positiveInteger(values.chunks ?? "", 1),
        "INVALID_ARGUMENT",
      );
      const kind = (values.kind ?? "mixed") as ScaleCorpusKind;
      if (!["code", "text", "mixed"].includes(kind))
        return yield* Errors.fail("INVALID_ARGUMENT", "--kind must be code, text, or mixed");
      const result = yield* generateScaleCorpus(values.root ?? ".", { chunks, kind });
      if (values.json) yield* this._output.json(result);
      else
        yield* this._output.report({
          label: "Benchmark",
          level: "info",
          text: `${result.files} files generated at ${result.root}; estimated chunks=${result.estimatedChunks}`,
          tags: ["scale-corpus"],
        });
      return 0;
    });
  }
  private _benchmarkRelevance(args: string[]) {
    return Effect.gen(this, function* () {
      const { values, positionals } = yield* Errors.attempt(
        () =>
          parseArgs({
            args,
            allowPositionals: true,
            options: {
              ...COMMON_OPTIONS,
              "top-k": { type: "string" },
              rerank: { type: "boolean" },
              policy: { type: "string" },
              "min-relevance": { type: "string" },
              "run-paid": { type: "boolean" },
            },
          }),
        "INVALID_ARGUMENT",
      );
      if (
        positionals.length !== 1 ||
        !values.root ||
        !values["run-paid"] ||
        !["answer-if-any", "rerank-min-relevance"].includes(values.policy ?? "") ||
        values["top-k"] === undefined ||
        (values.policy === "rerank-min-relevance" &&
          (!values.rerank || values["min-relevance"] === undefined))
      )
        return yield* Errors.fail(
          "INVALID_ARGUMENT",
          "Use benchmark-relevance <suite.json> --root <corpora-parent> --top-k <n> --policy answer-if-any|rerank-min-relevance --run-paid [--rerank --min-relevance <0..1>] [--json]",
        );
      const topK = yield* Errors.attempt(
        () => positiveInteger(values["top-k"]!, 1),
        "INVALID_ARGUMENT",
      );
      const minRelevance =
        values["min-relevance"] === undefined
          ? undefined
          : yield* Errors.attempt(() => Number(values["min-relevance"]), "INVALID_ARGUMENT");
      const result = yield* runRelevanceSuite(positionals[0]!, values.root, {
        topK,
        rerank: values.rerank ?? false,
        policy: values.policy as "answer-if-any" | "rerank-min-relevance",
        minRelevance,
      }).pipe(
        Effect.provide(RetrievalLive),
        Effect.provide(IntentLive),
        Effect.provide(PublicationLive),
      );
      if (values.json) yield* this._output.json(result);
      else
        yield* this._output.report({
          label: "Benchmark",
          level: result.complete ? "info" : "warning",
          text: JSON.stringify(result, null, 2),
        });
      return result.complete ? 0 : 1;
    });
  }
  private _evaluateRelevance(args: string[]) {
    return Effect.gen(this, function* () {
      const { values, positionals } = yield* Errors.attempt(
        () =>
          parseArgs({
            args,
            allowPositionals: true,
            options: {
              json: { type: "boolean" },
              "top-k": { type: "string" },
            },
          }),
        "INVALID_ARGUMENT",
      );
      if (positionals.length !== 1 || values["top-k"] === undefined)
        return yield* Errors.fail(
          "INVALID_ARGUMENT",
          "Use evaluate-relevance <cases.json> --top-k <n> [--json]",
        );
      const k = yield* Errors.attempt(
        () => positiveInteger(values["top-k"]!, 1),
        "INVALID_ARGUMENT",
      );
      const result = yield* evaluateRelevanceFile(positionals[0]!, k);
      if (values.json) yield* this._output.json(result);
      else {
        yield* this._output.report({
          label: "Benchmark",
          level: "info",
          text: `${result.cases} cases: ${result.positiveCases} positive, ${result.negativeCases} negative; cutoff=${result.k}. Metrics are not a semantic quality pass.`,
          tags: ["summary"],
        });
        yield* this._output.report({
          label: "Benchmark",
          level: "info",
          text: JSON.stringify(result, null, 2),
        });
      }
      return 0;
    });
  }
  private _benchmarkSummary(args: string[]) {
    return Effect.gen(this, function* () {
      const { values, positionals } = yield* Errors.attempt(
        () => parseArgs({ args, allowPositionals: true, options: COMMON_OPTIONS }),
        "INVALID_ARGUMENT",
      );
      const result = yield* summarizeBenchmarkReportFiles(positionals);
      if (values.json) yield* this._output.json(result);
      else {
        yield* this._output.report({
          label: "Benchmark",
          level: "info",
          text: `${result.reports} timing reports summarized from ${result.files.length} files`,
          tags: ["summary"],
        });
        yield* this._output.table(
          { label: "Benchmark", level: "info", tags: ["timing"] },
          {
            columns: [
              { heading: "Stage" },
              { heading: "Samples", align: "right" },
              { heading: "p50 (ms)", align: "right" },
              { heading: "p95 (ms)", align: "right" },
              { heading: "Min (ms)", align: "right" },
              { heading: "Max (ms)", align: "right" },
            ],
            rows: result.summaries.map((summary) => [
              summary.stage,
              String(summary.samples),
              summary.p50Milliseconds.toFixed(1),
              summary.p95Milliseconds.toFixed(1),
              summary.minMilliseconds.toFixed(1),
              summary.maxMilliseconds.toFixed(1),
            ]),
          },
        );
      }
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
