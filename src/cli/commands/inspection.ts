import { parseArgs } from "node:util";
import { Effect } from "effect";
import { Errors } from "../../errors/index.js";
import {
  inspectRecords,
  inspectTaxonomy,
  inspectValidation,
  repairProjections,
} from "../../onboarding/inspect.js";
import { COMMON_OPTIONS } from "../consts.js";
import { CorpusCommand } from "./base.js";

export class InspectionCommands extends CorpusCommand {
  public inspect(args: string[]) {
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
      yield* this._reportCorpus(values.json);
      const result = yield* positionals[0] === "records"
        ? inspectRecords(values.root ?? ".")
        : positionals[0] === "taxonomy"
          ? inspectTaxonomy(values.root ?? ".")
          : inspectValidation(values.root ?? ".");
      if (values.json) yield* this._json(result);
      else
        yield* this._output.report({
          label: "Inspection",
          level: "info",
          text: JSON.stringify(result, null, 2),
        });
      return "complete" in result && !result.complete ? 1 : 0;
    });
  }

  public repairProjections(args: string[]) {
    return Effect.gen(this, function* () {
      const { values, positionals } = yield* Errors.attempt(
        () => parseArgs({ args, allowPositionals: true, options: COMMON_OPTIONS }),
        "INVALID_ARGUMENT",
      );
      if (positionals.length)
        return yield* Errors.fail("INVALID_ARGUMENT", "Use repair-projections --root <path>");
      yield* this._reportCorpus(values.json);
      const result = yield* repairProjections(values.root ?? ".");
      if (values.json) yield* this._json(result);
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
}
