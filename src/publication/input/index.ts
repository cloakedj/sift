import { Tokenizer } from "@huggingface/tokenizers";
import { Context, Effect, Layer } from "effect";
import { Errors } from "../../errors/index.js";
import { DEFAULT_WORKERS_AI_MODEL } from "../consts.js";
import tokenizerData from "./assets/tokenizer.json" with { type: "json" };
import tokenizerConfig from "./assets/tokenizer_config.json" with { type: "json" };
import { MAX_INPUT_TOKENS, TOKENIZER_ID } from "./consts.js";

export class EmbeddingInputService {
  private _tokenizer: Tokenizer | undefined;

  /**
   * Encode locally with special tokens and no truncation or padding. Initialization
   * is lazy and performs no I/O; both tokenizer artifacts are bundled with the app.
   * Counts describe the pinned upstream tokenizer, not verified hosted parity.
   */
  public encode(text: string) {
    return Errors.attempt(() => {
      this._tokenizer ??= new Tokenizer(tokenizerData, tokenizerConfig);
      return this._tokenizer.encode(text, { add_special_tokens: true }).ids;
    }, "INVALID_DATA");
  }

  public validate(text: string, model: string) {
    return Effect.gen(this, function* () {
      if (model !== DEFAULT_WORKERS_AI_MODEL)
        return yield* Errors.fail("CONFIGURATION", "No pinned tokenizer for this embedding model");
      const ids = yield* this.encode(text);
      if (ids.length > MAX_INPUT_TOKENS)
        return yield* Errors.fail(
          "PAYLOAD_LIMIT",
          "Embedding input exceeds the 512-token local limit",
          {
            tokens: ids.length,
            limit: MAX_INPUT_TOKENS,
            tokenizer: TOKENIZER_ID,
          },
        );
      if (ids.length <= 2)
        return yield* Errors.fail("INVALID_ARGUMENT", "Embedding input contains no text tokens");
      return { tokens: ids.length, tokenizer: TOKENIZER_ID };
    });
  }
}

export class EmbeddingInput extends Context.Tag("EmbeddingInput")<
  EmbeddingInput,
  EmbeddingInputService
>() {}
export const EmbeddingInputLive = Layer.succeed(EmbeddingInput, new EmbeddingInputService());
