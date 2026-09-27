import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";

export interface JudgmentCache {
  schemaVersion: 1;
  fingerprint: string;
  response: Pick<SystemOneResult<Questions>, "model" | "answers">;
}

export interface RelevanceJudgment {
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
  model: string;
  questionSetVersion: string;
  fingerprint: string;
}
