import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { createMessages } from "../src/messages/index.js";
import type { Message, MessageSink } from "../src/messages/types.js";
import { formatMessage } from "../src/messages/utils.js";

test("central messages preserve labels, severity and tags while JSON stays undecorated", () => {
  const received: { message: Message; diagnostic: boolean }[] = [];
  const output: string[] = [];
  const sink: MessageSink = {
    message(message, diagnostic) {
      received.push({ message, diagnostic });
    },
    output(value) {
      output.push(value);
    },
  };
  const messages = createMessages({ sink, diagnosticsToStderr: true });
  const message: Message = {
    label: "Scenario",
    level: "warning",
    text: "Needs review",
    tags: ["summary", "highlight"],
  };
  Effect.runSync(messages.report(message));
  Effect.runSync(messages.json({ complete: true }));
  assert.deepEqual(received, [{ message, diagnostic: true }]);
  assert.equal(formatMessage(message), "Scenario: [Warning] Needs review");
  assert.deepEqual(output, ['{"complete":true}']);
});
