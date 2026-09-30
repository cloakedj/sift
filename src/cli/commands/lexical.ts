import { parseArgs } from "node:util";
import { Effect } from "effect";
import { Errors } from "../../errors/index.js";
import { Lexical } from "../../lexical/index.js";
import { COMMON_OPTIONS } from "../consts.js";
import { selectRoot } from "../utils.js";
import { CorpusCommand } from "./base.js";

export class LexicalCommands extends CorpusCommand {
  public run(command: "index" | "search", args: string[]) {
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
      yield* this._reportCorpus(values.json);
      const result = yield* command === "index"
        ? service.build(root)
        : service.search(positionals.join(" "), root);
      if (values.json) yield* this._json(result);
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
