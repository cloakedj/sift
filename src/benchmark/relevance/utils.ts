import { Errors } from "../../errors/index.js";
import type { RelevanceCase, RelevanceEvaluation } from "./types.js";

function ids(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((id) => typeof id === "string" && id.trim().length > 0) &&
    new Set(value).size === value.length
  );
}

/**
 * Evaluate a fully labeled, fixed-corpus run. Ranking metrics use only positive
 * cases and the first k retrieved IDs; no-answer cases measure the supplied
 * policy decision separately. Missing cohorts return null, never a perfect score.
 * Labels must be exhaustive: unknown retrieved IDs count as distractors.
 * This measures observations; it neither chooses nor calibrates an answer policy.
 */
export function evaluateCases(input: unknown, k: number): RelevanceEvaluation {
  if (!Number.isSafeInteger(k) || k < 1)
    Errors.raise("INVALID_ARGUMENT", "Relevance cutoff must be a positive integer");
  if (!Array.isArray(input) || !input.length)
    Errors.raise("INVALID_DATA", "Provide a nonempty array of labeled relevance cases");
  const seen = new Set<string>();
  const cases: RelevanceCase[] = [];
  for (const item of input) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      !item.id.trim() ||
      seen.has(item.id) ||
      !ids(item.relevantIds) ||
      !ids(item.retrievedIds) ||
      typeof item.answered !== "boolean"
    )
      Errors.raise(
        "INVALID_DATA",
        "Relevance cases require unique IDs, unique chunk ID lists, and an explicit answer decision",
      );
    if (item.answered && !item.retrievedIds.length)
      Errors.raise("INVALID_DATA", "An answered case must include a retrieved candidate");
    seen.add(item.id);
    cases.push(item);
  }
  let positiveCases = 0;
  let negativeCases = 0;
  let hits = 0;
  let recall = 0;
  let reciprocalRank = 0;
  let falseAnswers = 0;
  let abstentions = 0;
  for (const item of cases) {
    if (!item.relevantIds.length) {
      negativeCases++;
      if (item.answered) falseAnswers++;
      continue;
    }
    positiveCases++;
    if (!item.answered) abstentions++;
    const relevant = new Set(item.relevantIds);
    const shortlist = item.retrievedIds.slice(0, k);
    const first = shortlist.findIndex((id) => relevant.has(id));
    if (first >= 0) {
      hits++;
      reciprocalRank += 1 / (first + 1);
    }
    recall += shortlist.filter((id) => relevant.has(id)).length / relevant.size;
  }
  return {
    k,
    cases: cases.length,
    positiveCases,
    negativeCases,
    hitRateAtK: positiveCases ? hits / positiveCases : null,
    meanRecallAtK: positiveCases ? recall / positiveCases : null,
    meanReciprocalRankAtK: positiveCases ? reciprocalRank / positiveCases : null,
    negativeFalseAnswerRate: negativeCases ? falseAnswers / negativeCases : null,
    positiveAbstentionRate: positiveCases ? abstentions / positiveCases : null,
  };
}
