import assert from "node:assert/strict";
import { test } from "node:test";
import { Cause, Effect, Exit } from "effect";
import { AppError, Errors } from "../src/errors/index.js";
import { MessageService } from "../src/messages/index.js";
import type { Message } from "../src/messages/types.js";
import { JevService } from "../src/typesafe/client.js";
import { fakeJev } from "./support/jev.js";

test("central errors preserve identity, typed codes and safe serialization", () => {
  const error = Errors.create("STORE_LOCKED", "Another run owns the lock", {
    path: "/fixture/.jev/onboarding.lock",
  });
  assert.ok(error instanceof AppError);
  assert.equal(Errors.normalize(error), error);
  assert.equal(Errors.fromCause(Cause.die(error)), error);
  assert.deepEqual(Errors.serialize(error), {
    code: "STORE_LOCKED",
    reason: "Another run owns the lock",
    message: "Another run owns the lock",
    metadata: { path: "/fixture/.jev/onboarding.lock" },
    retryable: false,
  });
  const normalized = Errors.normalize(
    { status: 401, message: "secret-token", body: "source content", stack: "private" },
    "PROVIDER",
  );
  assert.equal(normalized.retryable, false);
  assert.equal(normalized.metadata.status, 401);
  assert.ok(!JSON.stringify(Errors.serialize(normalized)).includes("secret"));
  assert.ok(!JSON.stringify(Errors.serialize(normalized)).includes("source content"));
  const exit = Effect.runSyncExit(
    Errors.fail("INVALID_ARGUMENT", "Bad limit", { argument: "limit" }),
  );
  assert.ok(Exit.isFailure(exit));
  if (Exit.isFailure(exit)) assert.equal(Errors.fromCause(exit.cause).code, "INVALID_ARGUMENT");
});

test("central reporting carries the same error contract through the message sink", () => {
  const received: Message[] = [];
  const output = new MessageService({
    sink: {
      message(message) {
        received.push(message);
      },
      output() {},
    },
  });
  const error = Errors.create("CONFIGURATION", "Missing credential", { field: "TYPESAFE_API_KEY" });
  Effect.runSync(output.error("Scenario", error));
  assert.equal(received[0]!.label, "Scenario");
  assert.deepEqual(received[0]!.error, Errors.serialize(error));
  assert.deepEqual(received[0]!.tags, ["CONFIGURATION"]);
});

test("Effect retries transient provider failures but not permanent failures", async () => {
  const fake = fakeJev();
  let calls = 0;
  const transient = new JevService({
    model: fake.client.model,
    evaluate(request) {
      calls++;
      return calls === 1 ? Promise.reject({ status: 503 }) : fake.client.evaluate(request);
    },
  });
  const request = { state: "fixture", questions: { question: { type: "noul" as const } } };
  await Effect.runPromise(transient.evaluate(request));
  assert.equal(calls, 2);
  calls = 0;
  const permanent = new JevService({
    model: fake.client.model,
    evaluate() {
      calls++;
      return Promise.reject({ status: 401 });
    },
  });
  const exit = await Effect.runPromiseExit(permanent.evaluate(request));
  assert.equal(calls, 1);
  assert.ok(Exit.isFailure(exit));
  if (Exit.isFailure(exit)) assert.equal(Errors.fromCause(exit.cause).metadata.status, 401);
});
