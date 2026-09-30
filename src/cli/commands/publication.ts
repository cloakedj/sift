import { parseArgs } from "node:util";
import { Effect } from "effect";
import { Errors } from "../../errors/index.js";
import { publicationStatus, publishVectors, PublicationLive } from "../../publication/index.js";
import { COMMON_OPTIONS } from "../consts.js";
import { CorpusCommand } from "./base.js";

export class PublicationCommands extends CorpusCommand {
  public publish(args: string[]) {
    return Effect.gen(this, function* () {
      const { values, positionals } = yield* Errors.attempt(
        () => parseArgs({ args, allowPositionals: true, options: COMMON_OPTIONS }),
        "INVALID_ARGUMENT",
      );
      if (positionals.length)
        return yield* Errors.fail("INVALID_ARGUMENT", "Use publish --root <path>");
      yield* this._reportCorpus(values.json);
      const result = yield* publishVectors(values.root ?? ".").pipe(
        Effect.provide(PublicationLive),
      );
      if (values.json) yield* this._json(result);
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

  public status(args: string[]) {
    return Effect.gen(this, function* () {
      const { values, positionals } = yield* Errors.attempt(
        () => parseArgs({ args, allowPositionals: true, options: COMMON_OPTIONS }),
        "INVALID_ARGUMENT",
      );
      if (positionals.length)
        return yield* Errors.fail("INVALID_ARGUMENT", "Use status --root <path>");
      yield* this._reportCorpus(values.json);
      const result = yield* publicationStatus(values.root ?? ".").pipe(
        Effect.provide(PublicationLive),
      );
      if (values.json) yield* this._json(result);
      else
        yield* this._output.report({
          label: "Status",
          level: result.complete ? "info" : "warning",
          text: JSON.stringify(result, null, 2),
        });
      return result.complete ? 0 : 1;
    });
  }
}
