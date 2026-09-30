import { Effect } from "effect";
import type { MessageService } from "../../messages/index.js";
import { ResolvedCorpus } from "../corpus/index.js";

export abstract class CorpusCommand {
  public constructor(protected readonly _output: MessageService) {}

  protected _reportCorpus(json?: boolean) {
    return Effect.gen(this, function* () {
      const corpus = yield* ResolvedCorpus;
      if (corpus && !json)
        yield* this._output.report({
          label: "Corpus",
          level: "info",
          text: `Root: ${corpus.resolvedRoot}; config: ${corpus.configPath ?? "none"}; state: ${corpus.stateDirectory}`,
        });
    });
  }

  protected _json(value: unknown) {
    return Effect.gen(this, function* () {
      const corpus = yield* ResolvedCorpus;
      yield* this._output.json(
        corpus
          ? { ...(Array.isArray(value) ? { results: value } : (value as object)), ...corpus }
          : value,
      );
    });
  }
}
