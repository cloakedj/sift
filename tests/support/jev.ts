import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import type { JevClient } from "../../src/typesafe/types.js";
export function fakeJev() {
  const calls: SystemOneRequest<Questions>[] = [];
  const client: JevClient = {
    model: "test-pinned-model",
    async evaluate(request) {
      calls.push(request);
      const answers: Record<string, SystemOneResult<Questions>["answers"][string]> = {};
      for (const [key, question] of Object.entries(request.questions)) {
        if (question.type === "choice") {
          const governance = "useful" in question.criteria;
          const selected = governance ? "useful" : "code";
          answers[key] = {
            type: "choice",
            choice: selected,
            confidence: 1,
            probabilities: Object.fromEntries(
              Object.keys(question.criteria).map((name) => [name, name === selected ? 1 : 0]),
            ),
          };
        } else if (question.type === "score")
          answers[key] = {
            type: "score",
            score: 2,
            confidence: 1,
            legend: { 0: "Not relevant", 1: "Secondary", 2: "Central" },
            probabilities: { 0: 0, 1: 0, 2: 1 },
          };
        else answers[key] = { type: "noul", noul: 1 };
      }
      return { model: client.model, answers, usage: { input_tokens: 1, output_tokens: 1 } };
    },
  };
  return { client, calls };
}
