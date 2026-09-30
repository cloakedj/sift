import { parseArgs } from "node:util";
import { Effect } from "effect";
import { Errors } from "../../errors/index.js";
import { inferQuery, IntentLive } from "../../intent/index.js";
import { agentSearchReport } from "../../messages/search/utils.js";
import { PublicationLive } from "../../publication/index.js";
import { searchSemantic, RetrievalLive } from "../../retrieval/index.js";
import { COMMON_OPTIONS } from "../consts.js";
import { positiveInteger } from "../utils.js";
import { CorpusCommand } from "./base.js";

export class SearchCommand extends CorpusCommand {
  public run(args: string[]) {
    return Effect.gen(this, function* () {
      const { values, positionals } = yield* Errors.attempt(
        () =>
          parseArgs({
            args,
            allowPositionals: true,
            options: {
              ...COMMON_OPTIONS,
              "show-intent": { type: "boolean" },
              agent: { type: "boolean" },
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
      if (values.agent && (!values.json || values["show-intent"]))
        return yield* Errors.fail(
          "INVALID_ARGUMENT",
          "--agent requires --json and retrieval, not --show-intent",
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
      yield* this._reportCorpus(values.json);
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
      if (values.json)
        yield* this._json(
          values.agent && "results" in result
            ? yield* Errors.attempt(() => agentSearchReport(result), "INVALID_DATA")
            : result,
        );
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
}
