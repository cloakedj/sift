import { Errors } from "../errors/index.js";
import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";

export function validateResult(
  result: SystemOneResult<Questions>,
  questions: Questions,
  model: string,
) {
  if (!result || result.model !== model || !result.answers)
    Errors.raise("PROVIDER_RESPONSE", "Jev returned an unexpected model or missing answers");
  const probability = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
  for (const [key, question] of Object.entries(questions)) {
    const answer = result.answers[key];
    if (!answer || answer.type !== question.type)
      Errors.raise("PROVIDER_RESPONSE", `Invalid Jev answer type: ${key}`);
    if (answer.type === "noul") {
      if (!probability(answer.noul))
        Errors.raise("PROVIDER_RESPONSE", `Invalid probability: ${key}`);
      continue;
    }
    if (
      !probability(answer.confidence) ||
      !answer.probabilities ||
      !Object.values(answer.probabilities).every(probability)
    )
      Errors.raise("PROVIDER_RESPONSE", `Invalid Jev confidence/probabilities: ${key}`);
    const criteria =
      question.type === "choice"
        ? Object.keys(question.criteria)
        : question.type === "score"
          ? question.criteria.map((_, i) => String(i))
          : [];
    if (
      Object.keys(answer.probabilities).length !== criteria.length ||
      !criteria.every((label) => label in answer.probabilities) ||
      Math.abs(Object.values(answer.probabilities).reduce((a, b) => a + b, 0) - 1) > 0.02
    )
      Errors.raise("PROVIDER_RESPONSE", `Invalid probability distribution: ${key}`);
    if (answer.type === "choice" && !criteria.includes(answer.choice))
      Errors.raise("PROVIDER_RESPONSE", `Invalid Jev choice: ${key}`);
    if (
      answer.type === "score" &&
      (!Number.isFinite(answer.score) || answer.score < 0 || answer.score > criteria.length - 1)
    )
      Errors.raise("PROVIDER_RESPONSE", `Invalid Jev score: ${key}`);
  }
}
