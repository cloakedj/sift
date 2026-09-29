import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Layer } from "effect";
import { MessageService, Messages } from "../src/messages/index.js";
import { LocalRuntimeLive } from "../src/runtime/index.js";
import { Errors } from "../src/errors/index.js";

test("CLI message configuration overrides the local runtime default", async () => {
  const output = new MessageService({ diagnosticsToStderr: true });
  const selected = await Effect.runPromise(
    Messages.pipe(Effect.provide(Layer.merge(LocalRuntimeLive, Layer.succeed(Messages, output)))),
  );
  assert.equal(selected, output);
});

test("switching displays stops the previous handle and scopes clean up on every exit", async () => {
  for (const outcome of [Effect.void, Errors.fail("IO", "controlled"), Effect.interrupt]) {
    const messages = new MessageService({ enableProgress: false });
    let stopped = 0;
    const program = Effect.scoped(
      Effect.gen(function* () {
        const spinner = yield* messages.activity("Discovering");
        const stop = spinner.stop.bind(spinner);
        spinner.stop = () => {
          stopped++;
          stop();
        };
        const bar = messages.progress({ label: "Chunks", total: 2 });
        assert.equal(stopped, 1);
        bar.update(1);
        bar.increment();
        bar.stop();
        yield* outcome;
      }),
    );
    await Effect.runPromiseExit(program);
    assert.equal(stopped, 2);
  }
});

test("JSON mode suppresses bars and spinners even when progress is requested", () => {
  const messages = new MessageService({ diagnosticsToStderr: true, enableProgress: true });
  const spinner = messages.spinner("Waiting");
  const bar = messages.progress({ label: "Chunks", total: 1 });
  bar.increment();
  bar.stop();
  spinner.stop();
});
