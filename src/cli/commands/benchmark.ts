import { parseArgs } from "node:util";
import { Effect } from "effect";
import {
  evaluateRelevanceFile,
  generateScaleCorpus,
  summarizeBenchmarkReportFiles,
} from "../../benchmark/index.js";
import type { ScaleCorpusKind } from "../../benchmark/types.js";
import { runRelevanceSuite } from "../../benchmark/relevance-run/index.js";
import { Errors } from "../../errors/index.js";
import { IntentLive } from "../../intent/index.js";
import type { MessageService } from "../../messages/index.js";
import { PublicationLive } from "../../publication/index.js";
import { RetrievalLive } from "../../retrieval/index.js";
import { COMMON_OPTIONS } from "../consts.js";
import { positiveInteger } from "../utils.js";

export class BenchmarkCommands {
  public constructor(private readonly _output: MessageService) {}

  public generateScaleCorpus(args: string[]) {
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

  public relevance(args: string[]) {
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

  public evaluateRelevance(args: string[]) {
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

  public summary(args: string[]) {
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
}
