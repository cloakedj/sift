import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { EmbeddingInput, EmbeddingInputLive } from "../src/publication/input/index.js";
import {
  MAX_INPUT_TOKENS,
  TOKENIZER_CONFIG_SHA256,
  TOKENIZER_REVISION,
  TOKENIZER_SHA256,
} from "../src/publication/input/consts.js";
import { DEFAULT_WORKERS_AI_MODEL } from "../src/publication/consts.js";
import reference from "./support/bge-tokenizer-reference.json" with { type: "json" };

const encode = (text: string) =>
  Effect.runPromise(
    Effect.flatMap(EmbeddingInput, (service) => service.encode(text)).pipe(
      Effect.provide(EmbeddingInputLive),
    ),
  );
const validate = (text: string, model = DEFAULT_WORKERS_AI_MODEL) =>
  Effect.runPromise(
    Effect.flatMap(EmbeddingInput, (service) => service.validate(text, model)).pipe(
      Effect.provide(EmbeddingInputLive),
      Effect.either,
    ),
  );

test("bundled tokenizer artifacts retain pinned upstream hashes", async () => {
  for (const [name, expected] of [
    ["tokenizer.json", TOKENIZER_SHA256],
    ["tokenizer_config.json", TOKENIZER_CONFIG_SHA256],
  ]) {
    const data = await readFile(
      new URL(`../src/publication/input/assets/${name}`, import.meta.url),
    );
    assert.equal(createHash("sha256").update(data).digest("hex"), expected);
  }
});

test("offline tokenizer matches pinned Rust reference token IDs", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => assert.fail("Local tokenization must not access the network");
  try {
    assert.equal(reference.revision, TOKENIZER_REVISION);
    for (const { text, ids } of reference.cases)
      assert.deepEqual(await encode(text), ids, JSON.stringify(text));
  } finally {
    globalThis.fetch = original;
  }
});

test("token counts include special tokens and never truncate at the limit", async () => {
  for (const size of [511, 512, 513, 1024]) {
    const text = "hello ".repeat(size - 2);
    const ids = await encode(text);
    assert.equal(ids.length, size);
    assert.equal(ids[0], 101);
    assert.equal(ids.at(-1), 102);
    const result = await validate(text);
    if (size <= MAX_INPUT_TOKENS) {
      assert.ok(Either.isRight(result));
      assert.equal(result.right.tokens, size);
    } else {
      assert.ok(Either.isLeft(result));
      assert.equal(result.left.code, "PAYLOAD_LIMIT");
      assert.equal(result.left.metadata.tokens, size);
      assert.ok(!JSON.stringify(result.left).includes("hello"));
    }
  }
  for (const text of ["", " \t\n", "\u0000\u0001"]) {
    const result = await validate(text);
    assert.ok(Either.isLeft(result));
    assert.equal(result.left.code, "INVALID_ARGUMENT");
  }
  const unsupported = await validate("hello", "unknown-model");
  assert.ok(Either.isLeft(unsupported));
  assert.equal(unsupported.left.code, "CONFIGURATION");
});
