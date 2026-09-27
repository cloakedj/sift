import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { evaluateRelevance } from "../src/benchmark/relevance/index.js";
import type { RelevanceCase } from "../src/benchmark/relevance/types.js";

const positive: RelevanceCase = {
  id: "recovery",
  relevantIds: ["recovery-guide", "recovery-code"],
  retrievedIds: ["distractor", "recovery-guide", "recovery-code"],
  answered: true,
};

test("relevance evaluation separates shortlist quality from explicit no-answer decisions", async () => {
  const cases = [
    positive,
    { id: "miss", relevantIds: ["missing"], retrievedIds: [], answered: false },
    { id: "negative-correct", relevantIds: [], retrievedIds: ["distractor"], answered: false },
    { id: "negative-wrong", relevantIds: [], retrievedIds: ["distractor"], answered: true },
  ];
  const original = structuredClone(cases);
  assert.deepEqual(await Effect.runPromise(evaluateRelevance(cases, 2)), {
    k: 2,
    cases: 4,
    positiveCases: 2,
    negativeCases: 2,
    hitRateAtK: 0.5,
    meanRecallAtK: 0.25,
    meanReciprocalRankAtK: 0.25,
    negativeFalseAnswerRate: 0.5,
    positiveAbstentionRate: 0.5,
  });
  assert.deepEqual(cases, original);
  const cutoff = await Effect.runPromise(evaluateRelevance([positive], 1));
  assert.equal(cutoff.hitRateAtK, 0);
  assert.equal(cutoff.meanRecallAtK, 0);
  assert.equal(cutoff.meanReciprocalRankAtK, 0);
  assert.equal(cutoff.negativeFalseAnswerRate, null);
  const full = await Effect.runPromise(evaluateRelevance([positive], 10));
  assert.equal(full.meanRecallAtK, 1);
  assert.equal(full.meanReciprocalRankAtK, 0.5);
});

test("negative-only evaluation does not manufacture positive ranking evidence", async () => {
  const result = await Effect.runPromise(
    evaluateRelevance([{ id: "absent", relevantIds: [], retrievedIds: [], answered: false }], 8),
  );
  assert.equal(result.hitRateAtK, null);
  assert.equal(result.meanRecallAtK, null);
  assert.equal(result.meanReciprocalRankAtK, null);
  assert.equal(result.positiveAbstentionRate, null);
  assert.equal(result.negativeFalseAnswerRate, 0);
});

test("malformed and duplicate labels fail instead of biasing relevance metrics", async () => {
  for (const input of [
    null,
    {},
    [],
    [null],
    [positive, positive],
    [{ ...positive, id: " " }],
    [{ ...positive, answered: undefined }],
    [{ ...positive, answered: "false" }],
    [{ ...positive, retrievedIds: [] }],
    [{ ...positive, retrievedIds: ["x", "x"] }],
    [{ ...positive, relevantIds: ["x", "x"] }],
    [{ ...positive, relevantIds: [""] }],
    [{ ...positive, retrievedIds: [3] }],
    [{ ...positive, relevantIds: null }],
  ]) {
    const result = await Effect.runPromise(Effect.either(evaluateRelevance(input, 2)));
    assert.ok(Either.isLeft(result));
    assert.equal(result.left.code, "INVALID_DATA");
  }
  for (const k of [0, -1, 1.5, NaN, Infinity]) {
    const result = await Effect.runPromise(Effect.either(evaluateRelevance([positive], k)));
    assert.ok(Either.isLeft(result));
    assert.equal(result.left.code, "INVALID_ARGUMENT");
  }
});
