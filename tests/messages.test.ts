import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { createMessages } from "../src/messages/index.js";
import type { Message, MessageSink } from "../src/messages/types.js";
import { formatMessage, formatTable } from "../src/messages/utils.js";

test("tables align numeric cells and preserve message routing", () => {
  const table = {
    columns: [{ heading: "Stage" }, { heading: "ms", align: "right" as const }],
    rows: [
      ["discovery", "19.3"],
      ["taxonomy", "26491.9"],
    ],
  };
  assert.equal(
    formatTable(table),
    "Stage           ms\n---------  -------\ndiscovery     19.3\ntaxonomy   26491.9",
  );
  assert.ok(
    !formatTable({ columns: [{ heading: "Stage" }], rows: [["a\nb\u001b"]] }).includes("\u001b"),
  );
  const received: Message[] = [];
  const messages = createMessages({
    diagnosticsToStderr: true,
    sink: {
      message(message, diagnostic) {
        assert.equal(diagnostic, true);
        received.push(message);
      },
      output() {
        assert.fail("Table diagnostics must not use JSON stdout");
      },
    },
  });
  Effect.runSync(messages.table({ label: "Onboarding", level: "info", tags: ["timing"] }, table));
  assert.equal(received[0]?.text, `\n${formatTable(table)}`);
  assert.deepEqual(received[0]?.tags, ["timing"]);
});

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
