import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { Errors } from "../src/errors/index.js";
import { FileSystemService } from "../src/filesystem/index.js";
import { InventoryService } from "../src/inventory/index.js";
import { MessageService } from "../src/messages/index.js";

test("stage activity starts before work and stops on failure without decorating JSON", async () => {
  const events: string[] = [];
  class RecordingMessages extends MessageService {
    public override spinner(text: string) {
      events.push(text);
      return {
        update(value: string) {
          events.push(value);
        },
        stop() {
          events.push("stopped");
        },
      };
    }
  }
  const messages = new RecordingMessages({
    diagnosticsToStderr: true,
    sink: {
      message(message, diagnostic) {
        assert.equal(diagnostic, true);
        assert.equal(message.level, "info");
        events.push(message.text);
      },
      output(value) {
        events.push(value);
      },
    },
  });
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const activity = yield* messages.stage("Onboarding", "Loading configuration");
        activity.update("Discovering resources");
        return yield* Errors.fail("IO", "test failure");
      }),
    ).pipe(Effect.either),
  );
  await Effect.runPromise(messages.json({ complete: false }));
  assert.deepEqual(events, [
    "Loading configuration",
    "Onboarding: Loading configuration",
    "Discovering resources",
    "stopped",
    '{"complete":false}',
  ]);
});

test("discovery updates counts and reference-linking stages without changing inventory", async () => {
  const inventory = new InventoryService(new FileSystemService());
  const updates: string[] = [];
  const result = await Effect.runPromise(
    inventory.discover("tests/fixtures/mixed", undefined, {
      update(text) {
        updates.push(text);
      },
      stop() {},
    }),
  );
  const baseline = await Effect.runPromise(inventory.discover("tests/fixtures/mixed"));
  assert.deepEqual(result, baseline);
  assert.match(updates[0]!, /preparing discovery rules/);
  assert.ok(updates.some((text) => /1 read,/.test(text)));
  assert.match(updates.at(-2)!, /linking code references/);
  assert.match(updates.at(-1)!, /linking document structure/);
});
